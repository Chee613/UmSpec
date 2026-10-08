#!/usr/bin/env python3
"""
UmSpec - Zero-Touch SPeCTRUM Smart Audit & Exporter (CLI Edition)
Analyzes student degree, audits course materials, and packages everything into a structured ZIP.
Synchronized with SPeCTRUM Smart Export & UmSpec Browser Extension engine.
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

# Comprehensive UM Multi-Faculty Curriculum Knowledge Base (All 16 UM Faculties)
UM_CURRICULUM_CATALOG = {
    # 1. Faculty of Computer Science & Information Technology (FSKTM)
    'FSKTM_AI': {
        'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)',
        'degree': 'Bachelor of Computer Science (Artificial Intelligence)',
        'prefixes': ['WIE'],
        'signatureCodes': ['WIE2001', 'WIE2002', 'WIE2003', 'WIE3001', 'WIE3002', 'WIE3003', 'WIE3004'],
        'facultyPrefix': 'WI'
    },
    'FSKTM_SE': {
        'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)',
        'degree': 'Bachelor of Computer Science (Software Engineering)',
        'prefixes': ['WIA'],
        'signatureCodes': ['WIA2003', 'WIA2004', 'WIA2005', 'WIA3001', 'WIA3002', 'WIA3003', 'WIA3004'],
        'facultyPrefix': 'WI'
    },
    'FSKTM_DS': {
        'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)',
        'degree': 'Bachelor of Computer Science (Data Science)',
        'prefixes': ['WID'],
        'signatureCodes': ['WID2001', 'WID2002', 'WID2003', 'WID3001', 'WID3002', 'WID3003'],
        'facultyPrefix': 'WI'
    },
    'FSKTM_CSN': {
        'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)',
        'degree': 'Bachelor of Computer Science (Computer Systems and Networking)',
        'prefixes': ['WIC'],
        'signatureCodes': ['WIC2001', 'WIC2002', 'WIC2003', 'WIC3001', 'WIC3002', 'WIC3003'],
        'facultyPrefix': 'WI'
    },
    'FSKTM_IS': {
        'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)',
        'degree': 'Bachelor of Information Technology (Information Systems)',
        'prefixes': ['WIB'],
        'signatureCodes': ['WIB2001', 'WIB2002', 'WIB2003', 'WIB3001', 'WIB3002', 'WIB3003'],
        'facultyPrefix': 'WI'
    },
    'FSKTM_MM': {
        'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)',
        'degree': 'Bachelor of Science in Computer Science (Multimedia Computing)',
        'prefixes': ['WIF'],
        'signatureCodes': ['WIF2001', 'WIF2002', 'WIF2003', 'WIF3001', 'WIF3002'],
        'facultyPrefix': 'WI'
    },
    # 2. Faculty of Engineering (FK)
    'FK_ELEC': {
        'faculty': 'Faculty of Engineering',
        'degree': 'Bachelor of Electrical Engineering',
        'prefixes': ['KKE'],
        'signatureCodes': ['KKE1001', 'KKE2001', 'KKE2002', 'KKE3001', 'KKE3002', 'KKE4001'],
        'facultyPrefix': 'KK'
    },
    'FK_MECH': {
        'faculty': 'Faculty of Engineering',
        'degree': 'Bachelor of Mechanical Engineering',
        'prefixes': ['KKM', 'KIG'],
        'signatureCodes': ['KKM1001', 'KKM2001', 'KKM2002', 'KKM3001', 'KIG2001', 'KIG3001'],
        'facultyPrefix': 'KK'
    },
    'FK_CIVIL': {
        'faculty': 'Faculty of Engineering',
        'degree': 'Bachelor of Civil Engineering',
        'prefixes': ['KKA'],
        'signatureCodes': ['KKA1001', 'KKA2001', 'KKA2002', 'KKA3001', 'KKA4001'],
        'facultyPrefix': 'KK'
    },
    'FK_CHEM': {
        'faculty': 'Faculty of Engineering',
        'degree': 'Bachelor of Chemical Engineering',
        'prefixes': ['KKC'],
        'signatureCodes': ['KKC1001', 'KKC2001', 'KKC2002', 'KKC3001', 'KKC4001'],
        'facultyPrefix': 'KK'
    },
    'FK_BIOMED': {
        'faculty': 'Faculty of Engineering',
        'degree': 'Bachelor of Biomedical Engineering',
        'prefixes': ['KKB'],
        'signatureCodes': ['KKB1001', 'KKB2001', 'KKB2002', 'KKB3001', 'KKB4001'],
        'facultyPrefix': 'KK'
    },
    # 3. Faculty of Science (FS)
    'FS_MATH': {
        'faculty': 'Faculty of Science',
        'degree': 'Bachelor of Science in Mathematics',
        'prefixes': ['SIM'],
        'signatureCodes': ['SIM1001', 'SIM1002', 'SIM2001', 'SIM2002', 'SIM3001'],
        'facultyPrefix': 'SI'
    },
    'FS_ACTUARIAL': {
        'faculty': 'Faculty of Science',
        'degree': 'Bachelor of Actuarial Science',
        'prefixes': ['SIM'],
        'signatureCodes': ['SIM1003', 'SIM2003', 'SIM2004', 'SIM3003', 'SIM3004'],
        'facultyPrefix': 'SI'
    },
    'FS_CHEM': {
        'faculty': 'Faculty of Science',
        'degree': 'Bachelor of Science in Chemistry',
        'prefixes': ['SIC'],
        'signatureCodes': ['SIC1001', 'SIC1002', 'SIC2001', 'SIC2002', 'SIC3001'],
        'facultyPrefix': 'SI'
    },
    'FS_PHYS': {
        'faculty': 'Faculty of Science',
        'degree': 'Bachelor of Science in Physics',
        'prefixes': ['SIF'],
        'signatureCodes': ['SIF1001', 'SIF1002', 'SIF2001', 'SIF2002', 'SIF3001'],
        'facultyPrefix': 'SI'
    },
    'FS_BIO': {
        'faculty': 'Faculty of Science',
        'degree': 'Bachelor of Science in Biological Sciences & Biochemistry',
        'prefixes': ['SIB', 'SIJ', 'SIE'],
        'signatureCodes': ['SIB1001', 'SIJ1001', 'SIE1001', 'SIB2001', 'SIJ2001'],
        'facultyPrefix': 'SI'
    },
    'FS_GEOL': {
        'faculty': 'Faculty of Science',
        'degree': 'Bachelor of Science in Geology',
        'prefixes': ['SIG'],
        'signatureCodes': ['SIG1001', 'SIG1002', 'SIG2001', 'SIG2002', 'SIG3001'],
        'facultyPrefix': 'SI'
    },
    # 4. Faculty of Business and Economics (FPE)
    'FPE_ACC': {
        'faculty': 'Faculty of Business and Economics',
        'degree': 'Bachelor of Accounting',
        'prefixes': ['CIA'],
        'signatureCodes': ['CIA1001', 'CIA2001', 'CIA2002', 'CIA3001', 'CIA3002'],
        'facultyPrefix': 'CI'
    },
    'FPE_FIN': {
        'faculty': 'Faculty of Business and Economics',
        'degree': 'Bachelor of Finance',
        'prefixes': ['CIB'],
        'signatureCodes': ['CIB1001', 'CIB2001', 'CIB2002', 'CIB3001', 'CIB3002'],
        'facultyPrefix': 'CI'
    },
    'FPE_BBA': {
        'faculty': 'Faculty of Business and Economics',
        'degree': 'Bachelor of Business Administration',
        'prefixes': ['CIC', 'CID'],
        'signatureCodes': ['CIC1001', 'CIC2001', 'CID2001', 'CIC3001', 'CID3001'],
        'facultyPrefix': 'CI'
    },
    'FPE_ECON': {
        'faculty': 'Faculty of Business and Economics',
        'degree': 'Bachelor of Economics',
        'prefixes': ['EIA', 'EIB', 'EIC'],
        'signatureCodes': ['EIA1001', 'EIA2001', 'EIB2001', 'EIC2001', 'EIA3001'],
        'facultyPrefix': 'EI'
    },
    # 5. Faculty of Built Environment (FAB)
    'FAB_ARCH': {
        'faculty': 'Faculty of Built Environment',
        'degree': 'Bachelor of Science in Architecture',
        'prefixes': ['BIA'],
        'signatureCodes': ['BIA1001', 'BIA2001', 'BIA2002', 'BIA3001'],
        'facultyPrefix': 'BI'
    },
    'FAB_QS': {
        'faculty': 'Faculty of Built Environment',
        'degree': 'Bachelor of Quantity Surveying',
        'prefixes': ['BIE'],
        'signatureCodes': ['BIE1001', 'BIE2001', 'BIE2002', 'BIE3001'],
        'facultyPrefix': 'BI'
    },
    'FAB_BS': {
        'faculty': 'Faculty of Built Environment',
        'degree': 'Bachelor of Building Surveying',
        'prefixes': ['BIB'],
        'signatureCodes': ['BIB1001', 'BIB2001', 'BIB2002', 'BIB3001'],
        'facultyPrefix': 'BI'
    },
    'FAB_RE': {
        'faculty': 'Faculty of Built Environment',
        'degree': 'Bachelor of Real Estate',
        'prefixes': ['BIC'],
        'signatureCodes': ['BIC1001', 'BIC2001', 'BIC2002', 'BIC3001'],
        'facultyPrefix': 'BI'
    },
    'FAB_URP': {
        'faculty': 'Faculty of Built Environment',
        'degree': 'Bachelor of Urban and Regional Planning',
        'prefixes': ['BID'],
        'signatureCodes': ['BID1001', 'BID2001', 'BID2002', 'BID3001'],
        'facultyPrefix': 'BI'
    },
    # 6. Faculty of Law (FUU)
    'FUU_LLB': {
        'faculty': 'Faculty of Law',
        'degree': 'Bachelor of Laws (LLB)',
        'prefixes': ['LXEB', 'LIA', 'LQC', 'LXGA', 'LXGB'],
        'signatureCodes': ['LXEB1001', 'LXEB2001', 'LXEB2002', 'LXEB3001', 'LXEB4001'],
        'facultyPrefix': 'LX'
    },
    # 7. Faculty of Medicine (FOM)
    'FOM_MBBS': {
        'faculty': 'Faculty of Medicine',
        'degree': 'Bachelor of Medicine and Bachelor of Surgery (MBBS)',
        'prefixes': ['MIA', 'MID', 'MIE'],
        'signatureCodes': ['MIA1001', 'MID1001', 'MIE1001', 'MIA2001'],
        'facultyPrefix': 'MI'
    },
    'FOM_NURSING': {
        'faculty': 'Faculty of Medicine',
        'degree': 'Bachelor of Nursing Science',
        'prefixes': ['MIB', 'MNA'],
        'signatureCodes': ['MIB1001', 'MNA1001', 'MIB2001', 'MNA2001'],
        'facultyPrefix': 'MI'
    },
    'FOM_BIOMED': {
        'faculty': 'Faculty of Medicine',
        'degree': 'Bachelor of Biomedical Science',
        'prefixes': ['MIC'],
        'signatureCodes': ['MIC1001', 'MIC2001', 'MIC2002', 'MIC3001'],
        'facultyPrefix': 'MI'
    },
    # 8. Faculty of Pharmacy (FF)
    'FF_PHARM': {
        'faculty': 'Faculty of Pharmacy',
        'degree': 'Bachelor of Pharmacy',
        'prefixes': ['PIA', 'PIB', 'PIC', 'PIX'],
        'signatureCodes': ['PIA1001', 'PIB1001', 'PIC1001', 'PIX1001', 'PIA2001'],
        'facultyPrefix': 'PI'
    },
    # 9. Faculty of Dentistry (FPG)
    'FPG_BDS': {
        'faculty': 'Faculty of Dentistry',
        'degree': 'Bachelor of Dental Surgery (BDS)',
        'prefixes': ['DIA', 'DIB'],
        'signatureCodes': ['DIA1001', 'DIB1001', 'DIA2001', 'DIB2001'],
        'facultyPrefix': 'DI'
    },
    # 10. Faculty of Education (FP)
    'FP_EDU': {
        'faculty': 'Faculty of Education',
        'degree': 'Bachelor of Education (TESL / Counselling)',
        'prefixes': ['PGA', 'PGB', 'PGC', 'PIX'],
        'signatureCodes': ['PGA1001', 'PGB1001', 'PGC1001', 'PIX1001'],
        'facultyPrefix': 'PG'
    },
    # 11. Faculty of Languages and Linguistics (FLL)
    'FLL_LANG': {
        'faculty': 'Faculty of Languages and Linguistics',
        'degree': 'Bachelor of Arts in Linguistics / Languages',
        'prefixes': ['TIX', 'TIE', 'TIA', 'TIC', 'TIJ', 'TIG', 'TIF'],
        'signatureCodes': ['TIX1001', 'TIE1001', 'TIA1001', 'TIC1001', 'TIJ1001'],
        'facultyPrefix': 'TI'
    },
    # 12. Faculty of Arts and Social Sciences (FASS)
    'FASS_ARTS': {
        'faculty': 'Faculty of Arts and Social Sciences',
        'degree': 'Bachelor of Arts (Social Sciences & Humanities)',
        'prefixes': ['AIX', 'AIA', 'AIB', 'AIC', 'AID', 'AIE', 'AIG', 'AIH'],
        'signatureCodes': ['AIA1001', 'AIB1001', 'AIE1001', 'AIG1001', 'AIX1001'],
        'facultyPrefix': 'AI'
    },
    # 13. Faculty of Creative Arts (FCA)
    'FCA_ARTS': {
        'faculty': 'Faculty of Creative Arts',
        'degree': 'Bachelor of Performing / Visual Arts / Music',
        'prefixes': ['RIA', 'RIB', 'RIC', 'RID', 'RIE'],
        'signatureCodes': ['RIA1001', 'RIB1001', 'RIC1001', 'RID1001', 'RIE1001'],
        'facultyPrefix': 'RI'
    },
    # 14. Academy of Islamic Studies (API)
    'API_ISLAMIC': {
        'faculty': 'Academy of Islamic Studies',
        'degree': 'Bachelor of Islamic Studies (Shariah / Usuluddin)',
        'prefixes': ['IIX', 'IIA', 'IIB', 'IIC'],
        'signatureCodes': ['IIX1001', 'IIA1001', 'IIB1001', 'IIC1001'],
        'facultyPrefix': 'II'
    },
    # 15. Academy of Malay Studies (APM)
    'APM_MALAY': {
        'faculty': 'Academy of Malay Studies',
        'degree': 'Bachelor of Arts in Malay Studies',
        'prefixes': ['JIA', 'JIB'],
        'signatureCodes': ['JIA1001', 'JIB1001', 'JIA2001', 'JIB2001'],
        'facultyPrefix': 'JI'
    },
    # 16. Sports & Exercise Science (SES)
    'SES_SPORT': {
        'faculty': 'Centre for Sport & Exercise Sciences',
        'degree': 'Bachelor of Sports Science',
        'prefixes': ['VIA', 'VIB', 'VIC'],
        'signatureCodes': ['VIA1001', 'VIB1001', 'VIC1001', 'VIA2001'],
        'facultyPrefix': 'VI'
    }
}

def sanitize_name(name):
    if not name: return 'unnamed'
    name = re.sub(r'[\\/*?:"<>|]', '_', name)
    name = re.sub(r'\s+', ' ', name).strip(' .')
    return name[:160] or 'unnamed'

def format_course_folder(full_name, short_name=''):
    raw = full_name or short_name or 'Course Materials'
    # 1. Extract course code (e.g. WIA2007)
    code_m = re.search(r'([A-Z]{3}\d{4})', raw, re.I) or re.search(r'([A-Z]{3}\d{4})', short_name or '', re.I)
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

def map_department_to_degree(text):
    if not text: return None
    t = text.lower()
    if 'artificial intelligence' in t or 'kecerdasan buatan' in t:
        return {'degree': 'Bachelor of Computer Science (Artificial Intelligence)', 'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)'}
    if 'software engineering' in t or 'kejuruteraan perisian' in t:
        return {'degree': 'Bachelor of Computer Science (Software Engineering)', 'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)'}
    if 'data science' in t or 'sains data' in t:
        return {'degree': 'Bachelor of Computer Science (Data Science)', 'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)'}
    if 'computer system' in t or 'networking' in t or 'sistem komputer' in t or 'rangkaian' in t:
        return {'degree': 'Bachelor of Computer Science (Computer Systems and Networking)', 'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)'}
    if 'information system' in t or 'sistem maklumat' in t:
        return {'degree': 'Bachelor of Information Technology (Information Systems)', 'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)'}
    if 'multimedia' in t:
        return {'degree': 'Bachelor of Science in Computer Science (Multimedia Computing)', 'faculty': 'Faculty of Computer Science & Information Technology (FSKTM)'}
    if 'electrical' in t or 'elektrik' in t:
        return {'degree': 'Bachelor of Electrical Engineering', 'faculty': 'Faculty of Engineering'}
    if 'mechanical' in t or 'mekanikal' in t:
        return {'degree': 'Bachelor of Mechanical Engineering', 'faculty': 'Faculty of Engineering'}
    if 'civil' in t or 'awam' in t:
        return {'degree': 'Bachelor of Civil Engineering', 'faculty': 'Faculty of Engineering'}
    if 'chemical' in t or ('kimia' in t and 'kejuruteraan' in t):
        return {'degree': 'Bachelor of Chemical Engineering', 'faculty': 'Faculty of Engineering'}
    if 'biomedical' in t or 'bioperubatan' in t:
        return {'degree': 'Bachelor of Biomedical Engineering', 'faculty': 'Faculty of Engineering'}
    if 'accounting' in t or 'perakaunan' in t:
        return {'degree': 'Bachelor of Accounting', 'faculty': 'Faculty of Business and Economics'}
    if 'finance' in t or 'kewangan' in t:
        return {'degree': 'Bachelor of Finance', 'faculty': 'Faculty of Business and Economics'}
    if 'business' in t or 'perniagaan' in t or 'pentadbiran perniagaan' in t:
        return {'degree': 'Bachelor of Business Administration', 'faculty': 'Faculty of Business and Economics'}
    if 'economics' in t or 'ekonomi' in t:
        return {'degree': 'Bachelor of Economics', 'faculty': 'Faculty of Business and Economics'}
    if 'actuarial' in t or 'aktuari' in t:
        return {'degree': 'Bachelor of Actuarial Science', 'faculty': 'Faculty of Science'}
    return None

def calculate_year_semester(courses):
    years = []
    for c in courses:
        raw_text = f"{c.get('fullName', '')} {c.get('shortName', '')}"
        m = re.search(r'\b[A-Z]{3,4}(\d)\d{3}\b', raw_text, re.I)
        if m:
            y = int(m.group(1))
            if 1 <= y <= 4:
                years.append(y)
    inferred_year = round(sum(years) / len(years)) if years else 1

    month = datetime.now().month
    if 3 <= month <= 7:
        sem_str = 'Semester 2'
    elif 8 <= month <= 9:
        sem_str = 'Special Semester'
    else:
        sem_str = 'Semester 1'

    return f"Year {inferred_year}, {sem_str}"

def detect_academic_profile(courses, user_name, session=None):
    detected_bachelor = None
    detected_faculty = 'Universiti Malaya'
    detection_source = 'UM Multi-Faculty Curriculum Engine'

    # 1. Query SPeCTRUM user profile metadata if session is active
    if session:
        try:
            p_res = session.get(f"{BASE_URL}/user/profile.php", timeout=15)
            if p_res.status_code == 200:
                p_soup = BeautifulSoup(p_res.text, 'html.parser')
                p_text = " ".join(dd.get_text(strip=True) for dd in p_soup.select('.profile_tree dd, .profile_tree dt, dl dt, dl dd'))
                dept_degree = map_department_to_degree(p_text)
                if dept_degree:
                    detected_bachelor = dept_degree['degree']
                    detected_faculty = dept_degree['faculty']
                    detection_source = 'SPeCTRUM Profile Metadata (/user/profile.php)'
        except Exception:
            pass

    # 2. Multi-Faculty Weighted Bayesian Curriculum Inference
    if not detected_bachelor:
        scores = {k: 0 for k in UM_CURRICULUM_CATALOG}
        for c in courses:
            title_upper = (c.get('fullName', '') + ' ' + c.get('shortName', '')).upper()
            matches = re.findall(r'\b([A-Z]{3,4})([0-9]{4})\b', title_upper)
            for prefix, num in matches:
                full_code = prefix + num
                if prefix in ['GIG', 'GLT', 'GQX', 'GKN', 'GKA']:
                    continue
                for prog_key, prog in UM_CURRICULUM_CATALOG.items():
                    if full_code in prog.get('signatureCodes', []):
                        scores[prog_key] += 10
                    elif prefix in prog.get('prefixes', []):
                        scores[prog_key] += 6
                    elif prog.get('facultyPrefix') and prefix.startswith(prog['facultyPrefix']):
                        scores[prog_key] += 2

        best_key = None
        highest_score = 0
        for k, score in scores.items():
            if score > highest_score:
                highest_score = score
                best_key = k

        if best_key and highest_score > 0:
            best_prog = UM_CURRICULUM_CATALOG[best_key]
            detected_bachelor = best_prog['degree']
            detected_faculty = best_prog['faculty']
            detection_source = 'Curriculum Matrix Inference'

    # Fallback default
    if not detected_bachelor:
        detected_bachelor = 'Bachelor of Computer Science (Artificial Intelligence)'
        detected_faculty = 'Faculty of Computer Science & Information Technology (FSKTM)'
        detection_source = 'Curriculum Heuristic'

    return {
        'studentName': user_name or 'UM Student',
        'faculty': detected_faculty,
        'bachelor': detected_bachelor,
        'yearSem': calculate_year_semester(courses),
        'totalCourses': len(courses),
        'source': detection_source
    }

def classify_adaptive_category(act_name, sec_name, ext=''):
    """
    Adaptive taxonomy classification matching UmSpec Zero-Touch Engine & SPeCTRUM Smart Export.
    Categories:
      1.Lecture Slide (Lecture Slides / General Course Materials)
      2.Tutorials (Tutorials)
      3.Lab Materials (Labs)
      4.Past Year Questions (Past Year & Tests)
      5.Assignments & Projects (Assignments)
      6.Source Code & References (Source Code)
      7.Recordings & Media (Media & Videos)
    """
    text = f"{act_name or ''} {sec_name or ''}".lower()
    e = (ext or '').lower()

    if any(k in text for k in ['past year', 'pyq', 'exam', 'peperiksaan', 'sample paper', 'mid term', 'midterm', 'test']):
        return '4.Past Year Questions', 'Past Year & Tests'
    if any(k in text for k in ['tutorial', 'exercise', 'latihan', 'worksheet', 'tuto']):
        return '2.Tutorials', 'Tutorials'
    if any(k in text for k in ['lab', 'practical', 'amali', 'hands-on']):
        return '3.Lab Materials', 'Labs'
    if any(k in text for k in ['assignment', 'project', 'tugasan', 'rubric', 'milestone']):
        return '5.Assignments & Projects', 'Assignments'
    if any(k in text for k in ['lecture', 'slide', 'kuliah', 'topic', 'week', 'nota', 'notes', 'chapter', 'unit']):
        return '1.Lecture Slide', 'Lecture Slides'
    if e in ['.py', '.java', '.c', '.cpp', '.sql', '.html', '.js', '.css', '.ipynb', '.dart', '.kt', '.php'] or any(k in text for k in ['source code', 'script', 'code']):
        return '6.Source Code & References', 'Source Code'
    if e in ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.webm'] or any(k in text for k in ['recording', 'video', 'webinar']):
        return '7.Recordings & Media', 'Media & Videos'
    return '1.Lecture Slide', 'General Course Materials'

def run_smart_audit_and_export(cookie, output_dir=None):
    if not output_dir:
        output_dir = os.path.dirname(os.path.abspath(__file__))

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    session.cookies.set('MoodleSession', cookie, domain='spectrum.um.edu.my')

    print("="*65)
    print("UmSpec Zero-Touch Academic Audit & Smart Exporter")
    print("="*65)

    # 1. Connect & Get sesskey
    print("\n[1/5] Connecting to SPeCTRUM session...")
    resp = session.get(f'{BASE_URL}/my/', timeout=30)
    if 'login.microsoftonline.com' in resp.url or resp.status_code != 200:
        print("Error: MoodleSession cookie is invalid or expired. Please provide a fresh cookie.")
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

    # 3. Academic Profile Detection
    profile = detect_academic_profile(courses, user_name, session=session)
    print("\n" + "-"*65)
    print("STUDENT ACADEMIC PROFILE DETECTED:")
    print(f" * Student:       {profile['studentName']}")
    print(f" * Faculty:       {profile['faculty']}")
    print(f" * Programme:     {profile['bachelor']}")
    print(f" * Period:        {profile['yearSem']}")
    print(f" * Total Courses: {profile['totalCourses']} Enrolled Subjects")
    print(f" * Source:        {profile.get('source', 'Curriculum')}")
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
                audit_rows.append(f"| **{course['folderName']}** | {course['fullName']} | 0 files | Network Error |")
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
                except Exception:
                    pass

            if external_links:
                links_md = f"# Universiti Malaya - {course['fullName']} Resources\n\n"
                cur_sec = None
                for el in external_links:
                    if el['section'] != cur_sec:
                        cur_sec = el['section']
                        links_md += f"\n### {cur_sec}\n\n"
                    links_md += f"- [{el['title']}]({el['url']})\n"
                zf.writestr(f"{course['folderName']}/1.Lecture Slide/Lecture_Videos_and_Links.md", links_md)
                c_downloaded += 1
                total_files += 1

            status_text = "Active" if c_downloaded > 0 else "Empty on SPeCTRUM"
            audit_rows.append(f"| **{course['folderName']}** | {course['fullName']} | {c_downloaded} files | {status_text} |")

        target_ids = {c['id'] for c in target_courses}
        for c in courses:
            if c['id'] not in target_ids:
                audit_rows.append(f"| **{c['folderName']}** | {c['fullName']} | 0 files | Excluded by User |")

        # 5. Generate Academic Audit Report matching SPeCTRUM Smart Export standard
        print("\n[4/5] Generating SEMESTER_AUDIT_REPORT.md...")
        audit_md = f"""# Universiti Malaya - SPeCTRUM Semester Academic Audit

> **Auto-Generated by UmSpec Zero-Touch Engine** on {datetime.now().strftime('%m/%d/%Y, %I:%M:%S %p')}

---

## Student Academic Profile

* **Student:** {profile['studentName']}
* **Faculty:** {profile['faculty']}
* **Detected Programme:** {profile['bachelor']}
* **Academic Period:** {profile['yearSem']}
* **Total Enrolled Courses:** {len(courses)} Courses ({len(target_courses)} Exported)

---

## Course Content & Material Health Check

| Course Folder | Official Title | Materials Downloaded | Health Status |
| :--- | :--- | :---: | :--- |
{chr(10).join(audit_rows)}

---

## Discovered Material Taxonomy

The following categories were dynamically identified and organized across your courses:
{chr(10).join(f'* **{cat}**' for cat in sorted(discovered_taxonomies))}

---

## Total Archive Statistics
* **Total Files:** {total_files}
* **Total Uncompressed Size:** {total_bytes / (1024*1024):.2f} MB

*Preserve this audit report as your official semester archive index.*
"""
        zf.writestr("SEMESTER_AUDIT_REPORT.md", audit_md)

    print("\n[5/5] Packaging Finished!")
    print("="*65)
    print(f"Successfully Generated ZIP: {zip_path}")
    print(f"Total Files: {total_files} | Archive Size: {os.path.getsize(zip_path)/(1024*1024):.2f} MB")
    print("="*65)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python smart_audit_export.py <MoodleSessionCookie> [OptionalOutputDir]")
        sys.exit(1)
    c_arg = sys.argv[1].strip()
    out_arg = sys.argv[2].strip() if len(sys.argv) > 2 else None
    run_smart_audit_and_export(c_arg, out_arg)
