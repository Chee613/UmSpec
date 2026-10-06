#!/usr/bin/env python3
"""
UmSpec - Zero-Touch SPeCTRUM Smart Audit & Exporter (CLI Edition)
Analyzes student degree, audits course materials, and packages everything into a structured ZIP.
"""

import os
import sys
import re
import json
import zipfile
import urllib.parse
import mimetypes
import requests
from bs4 import BeautifulSoup
from datetime import datetime

BASE_URL = 'https://spectrum.um.edu.my'

def sanitize_name(name):
    if not name: return 'unnamed'
    name = re.sub(r'[\\/*?:"<>|]', '_', name)
    name = re.sub(r'\s+', ' ', name).strip(' .')
    return name[:150] or 'unnamed'

def format_course_folder(full_name, short_name=''):
    raw = full_name or short_name or 'Course Materials'
    # 1. Extract course code (e.g. WIA2007)
    code_m = re.search(r'([A-Z]{3}\d{4})', raw, re.I)
    code = code_m.group(1).upper() if code_m else ''

    # 2. Clean title: remove course codes, cross-listings, semester tags, brackets
    title = raw
    title = re.sub(r'[A-Z]{3}\d{4}(?:\s*/\s*[A-Z]{3}\d{4})*', ' ', title, flags=re.I)
    title = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', title)
    title = re.sub(r'\b(sem(?:ester)?\s*\d+|20\d\d\s*/\s*20\d\d|occ\s*\d+|sec(?:tion)?\s*\d+|kumpulan\s*\d+)\b', ' ', title, flags=re.I)
    title = re.sub(r'[^\w\s]', ' ', title)
    title = re.sub(r'\s+', ' ', title).strip()

    title_words = [w.capitalize() for w in title.split() if len(w) > 0]
    clean_title = ' '.join(title_words) or 'Course Materials'

    return sanitize_name(f"{code} {clean_title}".strip())

def detect_academic_profile(courses, user_name):
    codes = []
    for c in courses:
        m = re.search(r'([A-Z]{3})(\d)(\d{3})', c['fullName'], re.I)
        if m:
            codes.append({
                'prefix': m.group(1).upper(),
                'year': int(m.group(2)),
                'fullCode': f"{m.group(1).upper()}{m.group(2)}{m.group(3)}"
            })

    faculty = 'Universiti Malaya'
    bachelor = 'Bachelor Degree Programme'

    fsktm_cnt = sum(1 for c in codes if c['prefix'] in ['WIA', 'WIB', 'WIC', 'WID', 'WIX'])
    eng_cnt = sum(1 for c in codes if c['prefix'] in ['KIE', 'KKA', 'KMK', 'KBE'])
    arts_cnt = sum(1 for c in codes if c['prefix'] in ['AIA', 'AIB', 'GIG'])

    if fsktm_cnt >= 2:
        faculty = 'Faculty of Computer Science & Information Technology (FSKTM)'
        full_list = [c['fullCode'] for c in codes]
        all_titles = " ".join(c.get('fullName', '').lower() for c in courses)

        if any(c.startswith('WIC') for c in full_list) or 'artificial intelligence' in all_titles or 'machine learning' in all_titles or 'WIA2003' in full_list:
            bachelor = 'Bachelor of Computer Science (Artificial Intelligence)'
        elif any(c.startswith('WID') for c in full_list) or 'data science' in all_titles:
            bachelor = 'Bachelor of Computer Science (Data Science)'
        elif any(c.startswith('WIE') for c in full_list) or 'software architecture' in all_titles:
            bachelor = 'Bachelor of Computer Science (Software Engineering)'
        elif any(c.startswith('WIF') for c in full_list) or 'network' in all_titles:
            bachelor = 'Bachelor of Computer Science (Computer Systems and Networking)'
        elif any(c.startswith('WIB') for c in full_list) or 'information system' in all_titles:
            bachelor = 'Bachelor of Information Technology (Information Systems)'
        else:
            bachelor = 'Bachelor of Computer Science (Artificial Intelligence)'
    elif eng_cnt >= 2:
        faculty = 'Faculty of Engineering (FK)'
        bachelor = 'Bachelor of Engineering'
    elif arts_cnt >= 2:
        faculty = 'Faculty of Arts and Social Sciences (FASS)'
        bachelor = 'Bachelor of Arts / Social Sciences'

    years = [c['year'] for c in codes if 1 <= c['year'] <= 4]
    avg_year = round(sum(years) / len(years)) if years else 1

    return {
        'studentName': user_name or 'UM Student',
        'faculty': faculty,
        'bachelor': bachelor,
        'yearSem': f"Year {avg_year}, Semester 1",
        'totalCourses': len(courses)
    }

def classify_adaptive_category(item_name, section_name, ext=''):
    n = (item_name or '').lower()
    s = (section_name or '').lower()
    e = (ext or '').lower()

    if any(k in n or k in s for k in ['pyq', 'past year', 'exam paper', 'final exam']):
        return '5.Past Year Questions', 'Past Year Questions'
    if e in ['.java', '.py', '.c', '.cpp', '.sql', '.html', '.js', '.ipynb'] or 'source code' in n or 'starter kit' in n or 'source code' in s:
        return '6.Source Code', 'Source Code & Starter Kits'
    if e in ['.sav', '.csv', '.xlsx', '.xls'] or 'dataset' in n or 'data file' in n or 'dataset' in s:
        return '7.Datasets', 'Datasets & Statistical Files'
    if e in ['.mp4', '.wmv', '.mov', '.mkv', '.mp3'] or 'recorded lecture' in n or 'video' in n or 'video recording' in s:
        return '8.Video Lectures', 'Recorded Lectures & Videos'
    if 'tutorial' in n or 'tutorial' in s:
        return '2.Tutorial', 'Tutorials & Problem Sets'
    if any(k in n or k in s for k in ['lab', 'practical', 'pbl']):
        return '3.Lab', 'Labs & Practical Guides'
    if any(k in n or k in s for k in ['assignment', 'assign', 'project', 'case study', 'peer assessment', 'weekly progress', 'rubric', 'declaration form']):
        return '4.Assignment', 'Assignments & Project Briefs'
    if any(k in n or k in s for k in ['book', 'reference', 'additional material', 'extra note', 'guide']):
        return '9.Reference', 'References & Textbooks'
    return '1.Lecture Slide', 'Lecture Slides & Notes'

def run_smart_audit_and_export(cookie, output_dir=None):
    if not output_dir:
        output_dir = os.path.dirname(os.path.abspath(__file__))

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    session.cookies.set('MoodleSession', cookie, domain='spectrum.um.edu.my')

    print("="*65)
    print("🎓 UmSpec Zero-Touch Academic Audit & Smart Exporter")
    print("="*65)

    # 1. Connect & Get sesskey
    print("\n[1/5] Connecting to SPeCTRUM session...")
    resp = session.get(f'{BASE_URL}/my/', timeout=30)
    if 'login.microsoftonline.com' in resp.url or resp.status_code != 200:
        print("❌ Error: MoodleSession cookie is invalid or expired. Please provide a fresh cookie.")
        return

    soup = BeautifulSoup(resp.text, 'html.parser')
    user_el = soup.select_one('.usertext, .usermenu, .user-name')
    user_name = user_el.get_text(strip=True) if user_el else "UM Student"
    sesskey_m = re.search(r'"sesskey":"([^"]+)"', resp.text)
    sesskey = sesskey_m.group(1) if sesskey_m else None

    # 2. Discover Courses via Moodle API
    print(f"[2/5] Discovering enrolled curriculum for {user_name}...")
    courses = []
    if sesskey:
        api_url = f'{BASE_URL}/lib/ajax/service.php?sesskey={sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification'
        payload = [{
            "index": 0,
            "methodname": "core_course_get_enrolled_courses_by_timeline_classification",
            "args": { "offset": 0, "limit": 50, "classification": "all", "sort": "fullname" }
        }]
        try:
            r = session.post(api_url, json=payload, timeout=20)
            data = r.json()
            if isinstance(data, list) and len(data) > 0 and 'data' in data[0]:
                for c in data[0]['data'].get('courses', []):
                    courses.append({
                        'id': str(c.get('id')),
                        'fullName': c.get('fullname'),
                        'shortName': c.get('shortname'),
                        'folderName': format_course_folder(c.get('fullname'), c.get('shortname'))
                    })
        except Exception as e:
            print(f"Warning: AJAX course query error ({e}), scanning HTML...")

    if not courses:
        seen = set()
        for a in soup.select('a[href*="/course/view.php?id="]'):
            m = re.search(r'id=(\d+)', a['href'])
            if m:
                cid = m.group(1)
                name = a.get_text(strip=True)
                if name and cid not in seen:
                    seen.add(cid)
                    courses.append({
                        'id': cid,
                        'fullName': name,
                        'shortName': name,
                        'folderName': format_course_folder(name, name)
                    })

    # 3. Academic Profile Heuristic
    profile = detect_academic_profile(courses, user_name)
    print("\n" + "-"*65)
    print("📋 STUDENT ACADEMIC PROFILE DETECTED:")
    print(f" • Student:      {profile['studentName']}")
    print(f" • Faculty:      {profile['faculty']}")
    print(f" • Programme:    {profile['bachelor']}")
    print(f" • Period:       {profile['yearSem']}")
    print(f" • Total Courses: {profile['totalCourses']} Enrolled Subjects")
    print("-"*65)

    print("\n[+] ENROLLED COURSES:")
    for idx, c in enumerate(courses, 1):
        print(f"  [{idx}] {c['folderName']} - {c['fullName']}")

    selected_indices = None
    try:
        user_choice = input("\nSelect courses to export (e.g. 1,3,5 or press Enter for ALL): ").strip()
        if user_choice:
            selected_indices = [int(x.strip()) for x in user_choice.split(',') if x.strip().isdigit()]
    except (EOFError, KeyboardInterrupt):
        selected_indices = None

    target_courses = [courses[i - 1] for i in selected_indices if 1 <= i <= len(courses)] if selected_indices else courses
    print(f"\n[3/5] Performing adaptive material crawl for {len(target_courses)} selected course(s)...")

    date_str = datetime.now().strftime('%Y-%m-%d')
    zip_path = os.path.join(output_dir, f"SPeCTRUM_Smart_Export_{date_str}.zip")
    
    total_files = 0
    total_bytes = 0
    audit_rows = []
    discovered_taxonomies = set()

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for idx, course in enumerate(target_courses, 1):
            print(f"\n  -> [{idx}/{len(target_courses)}] Crawling: {course['folderName']} - {course['fullName']}")
            c_url = f'{BASE_URL}/course/view.php?id={course["id"]}'
            try:
                c_resp = session.get(c_url, timeout=30)
                c_soup = BeautifulSoup(c_resp.text, 'html.parser')
            except Exception as e:
                print(f"     Error loading course: {e}")
                audit_rows.append(f"| **{course['folderName']}** | {course['fullName']} | 0 files | ⚠️ Network Error |")
                continue

            items = []
            seen_urls = set()
            external_links = []

            sections = c_soup.select('.course-content ul.topics > li, .course-content ul.weeks > li, .course-content .section')
            for sec in sections:
                st = sec.select_one('.sectionname, .section-title, h3')
                sname = st.get_text(strip=True) if st else "General"

                for act in sec.select('.activity'):
                    mod_classes = [c for c in act.get('class', []) if 'modtype_' in c]
                    mod_type = mod_classes[0].replace('modtype_', '') if mod_classes else ''
                    if mod_type in ['attendance', 'forum', 'feedback', 'choice']: continue

                    inst = act.select_one('.instancename')
                    iname = inst.get_text(strip=True) if inst else "Material"
                    for sfx in ['File', 'URL', 'Assignment', 'Folder', 'Page', 'External tool']:
                        if iname.endswith(sfx): iname = iname[:-len(sfx)].strip()

                    link = act.select_one('a')
                    if not link or not link.get('href'): continue
                    url = link['href']
                    if url in seen_urls: continue
                    seen_urls.add(url)

                    cat_id, cat_label = classify_adaptive_category(iname, sname, os.path.splitext(url)[1])
                    discovered_taxonomies.add(cat_label)
                    items.append({'name': iname, 'url': url, 'type': mod_type, 'cat_id': cat_id, 'section': sname})

                # External YouTube/video links
                for ea in sec.select('a[href*="youtu.be"], a[href*="youtube.com"], a[href*="drive.google.com"]'):
                    external_links.append({'title': ea.get_text(strip=True) or 'External Lecture', 'url': ea['href'], 'section': sname})

            c_downloaded = 0
            for item in items:
                try:
                    with session.get(item['url'], stream=True, timeout=40) as r:
                        if r.status_code != 200: continue
                        ct = r.headers.get('Content-Type', '').lower()
                        if 'text/html' in ct:
                            h_soup = BeautifulSoup(r.text, 'html.parser')
                            if item['type'] == 'assign':
                                assign_files = h_soup.select('#intro a[href*="pluginfile.php"], .intro a[href*="pluginfile.php"], .fileuploadsubmission a[href*="pluginfile.php"]')
                                for af in assign_files:
                                    af_url = af.get('href')
                                    if not af_url: continue
                                    with session.get(af_url, stream=True, timeout=40) as ar:
                                        if ar.status_code != 200: continue
                                        cd = ar.headers.get('Content-Disposition', '')
                                        m_utf = re.search(r"filename\*=UTF-8''([^;\r\n]+)", cd, re.I)
                                        m_std = re.search(r'filename="([^"]+)"', cd, re.I)
                                        if m_utf: af_name = urllib.parse.unquote(m_utf.group(1))
                                        elif m_std: af_name = m_std.group(1)
                                        else: af_name = af.get_text(strip=True) or sanitize_name(item['name']) + '.pdf'
                                        af_name = sanitize_name(af_name)
                                        zf.writestr(f"{course['folderName']}/{item['cat_id']}/{af_name}", ar.content)
                                        c_downloaded += 1
                                        total_files += 1
                                        total_bytes += len(ar.content)
                                        print(f"       + [{item['cat_id']}] (Assign File) {af_name}")
                                continue
                            elif item['type'] == 'folder':
                                folder_files = h_soup.select('a[href*="pluginfile.php"]')
                                for ff in folder_files:
                                    ff_url = ff.get('href')
                                    if not ff_url: continue
                                    with session.get(ff_url, stream=True, timeout=40) as fr:
                                        if fr.status_code != 200: continue
                                        cd = fr.headers.get('Content-Disposition', '')
                                        m_utf = re.search(r"filename\*=UTF-8''([^;\r\n]+)", cd, re.I)
                                        m_std = re.search(r'filename="([^"]+)"', cd, re.I)
                                        if m_utf: ff_name = urllib.parse.unquote(m_utf.group(1))
                                        elif m_std: ff_name = m_std.group(1)
                                        else: ff_name = ff.get_text(strip=True) or sanitize_name(item['name']) + '.pdf'
                                        ff_name = sanitize_name(ff_name)
                                        zf.writestr(f"{course['folderName']}/{item['cat_id']}/{ff_name}", fr.content)
                                        c_downloaded += 1
                                        total_files += 1
                                        total_bytes += len(fr.content)
                                        print(f"       + [{item['cat_id']}] (Folder File) {ff_name}")
                                continue
                            else:
                                emb = h_soup.select_one('.resourceworkaround a, .resourcecontent object, a[href*="pluginfile.php"]')
                                if emb:
                                    next_url = emb.get('data') or emb.get('src') or emb.get('href')
                                    if next_url and 'pluginfile.php' in next_url:
                                        r = session.get(next_url, stream=True, timeout=40)
                                    else: continue
                                else: continue

                        # Filename resolution
                        cd = r.headers.get('Content-Disposition', '')
                        m_utf = re.search(r"filename\*=UTF-8''([^;\r\n]+)", cd, re.I)
                        m_std = re.search(r'filename="([^"]+)"', cd, re.I)
                        if m_utf: fname = urllib.parse.unquote(m_utf.group(1))
                        elif m_std: fname = m_std.group(1)
                        else:
                            pname = os.path.basename(urllib.parse.urlparse(r.url).path)
                            if pname and '.' in pname and not pname.endswith('.php'):
                                fname = urllib.parse.unquote(pname)
                            else:
                                ext = mimetypes.guess_extension(ct.split(';')[0]) or '.pdf'
                                fname = sanitize_name(item['name']) + ext

                        fname = sanitize_name(fname)
                        file_data = r.content
                        zip_entry = f"{course['folderName']}/{item['cat_id']}/{fname}"
                        zf.writestr(zip_entry, file_data)
                        c_downloaded += 1
                        total_files += 1
                        total_bytes += len(file_data)
                        print(f"       + [{item['cat_id']}] {fname} ({len(file_data):,} bytes)")
                except Exception as e:
                    pass

            if external_links:
                links_md = f"# 🎥 {course['fullName']} - Video Lectures & Resources\n\n"
                cur_sec = None
                for el in external_links:
                    if el['section'] != cur_sec:
                        cur_sec = el['section']
                        links_md += f"\n### {cur_sec}\n\n"
                    links_md += f"- [{el['title']}]({el['url']})\n"
                zf.writestr(f"{course['folderName']}/1.Lecture Slide/Lecture_Videos_and_Links.md", links_md)
                c_downloaded += 1
                total_files += 1

            status_text = "🟢 Active" if c_downloaded > 0 else "⚠️ Empty on SPeCTRUM"
            audit_rows.append(f"| **{course['folderName']}** | {course['fullName']} | {c_downloaded} files | {status_text} |")

        target_ids = {c['id'] for c in target_courses}
        for c in courses:
            if c['id'] not in target_ids:
                audit_rows.append(f"| **{c['folderName']}** | {c['fullName']} | 0 files | ⚪ Excluded by User |")

        # 5. Generate Academic Audit Report
        print("\n[4/5] Generating SEMESTER_AUDIT_REPORT.md...")
        audit_md = f"""# 🎓 Universiti Malaya - SPeCTRUM Semester Academic Audit

> **Auto-Generated by UmSpec Zero-Touch Engine** on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 🧑‍🎓 Student Academic Profile

* **Student:** {profile['studentName']}
* **Faculty:** {profile['faculty']}
* **Detected Programme:** {profile['bachelor']}
* **Academic Period:** {profile['yearSem']}
* **Total Enrolled Courses:** {profile['totalCourses']} Subjects

---

## 📊 Course Content & Material Health Check

| Course Folder | Official Title | Materials Downloaded | Health Status |
| :--- | :--- | :---: | :--- |
{chr(10).join(audit_rows)}

---

## 🗂️ Discovered Material Taxonomy
{chr(10).join(f'* **{cat}**' for cat in sorted(discovered_taxonomies))}

---

## 📦 Total Archive Statistics
* **Total Files:** {total_files}
* **Total Uncompressed Size:** {total_bytes / (1024*1024):.2f} MB
"""
        zf.writestr("SEMESTER_AUDIT_REPORT.md", audit_md)

    print("\n[5/5] Packaging Finished!")
    print("="*65)
    print(f"🎉 Successfully Generated ZIP: {zip_path}")
    print(f"📦 Total Files: {total_files} | Archive Size: {os.path.getsize(zip_path)/(1024*1024):.2f} MB")
    print("="*65)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python smart_audit_export.py <MoodleSessionCookie> [OptionalOutputDir]")
        sys.exit(1)
    c_arg = sys.argv[1].strip()
    out_arg = sys.argv[2].strip() if len(sys.argv) > 2 else None
    run_smart_audit_and_export(c_arg, out_arg)
