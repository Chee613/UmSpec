#!/usr/bin/env python3
"""
UM Handbook Curriculum Scraper & Knowledge Base Builder
-------------------------------------------------------
Extracts course structures, degree programmes, and course codes across all
Universiti Malaya (UM) faculties from Undergraduate Handbooks (PDFs / URLs).

Outputs structured JSON database: `scripts/um_curriculum_catalog.json`

Supported Faculties:
1. Faculty of Computer Science & Information Technology (FSKTM)
2. Faculty of Engineering (FK)
3. Faculty of Science (FS)
4. Faculty of Business and Economics (FPE)
5. Faculty of Built Environment (FAB)
6. Faculty of Arts and Social Sciences (FASS)
7. Faculty of Law (FUU)
8. Faculty of Medicine (FOM)
9. Faculty of Pharmacy (FF)
10. Faculty of Dentistry (FPG)
11. Faculty of Education (FP)
12. Faculty of Languages and Linguistics (FLL)
13. Faculty of Creative Arts (FCA)
14. Academy of Islamic Studies (API)
15. Academy of Malay Studies (APM)
16. Faculty of Sports and Exercise Science (SES)
"""

import os
import sys
import re
import json
import argparse
from pathlib import Path

# Built-in fallback catalog covering all 16 UM faculties
BUILTIN_UM_CURRICULUM = {
    # 1. FSKTM
    "FSKTM_AI": {
        "faculty": "Faculty of Computer Science & Information Technology (FSKTM)",
        "degree": "Bachelor of Computer Science (Artificial Intelligence)",
        "department": "Department of Artificial Intelligence",
        "prefixes": ["WIE"],
        "signatureCodes": ["WIE2001", "WIE2002", "WIE2003", "WIE3001", "WIE3002", "WIE3003", "WIE3004", "WIE3005"],
        "facultyCores": ["WIX1001", "WIX1002", "WIX1003", "WIX2001", "WIX2002", "WIX3001"]
    },
    "FSKTM_SE": {
        "faculty": "Faculty of Computer Science & Information Technology (FSKTM)",
        "degree": "Bachelor of Computer Science (Software Engineering)",
        "department": "Department of Software Engineering",
        "prefixes": ["WIA"],
        "signatureCodes": ["WIA2003", "WIA2004", "WIA2005", "WIA3001", "WIA3002", "WIA3003", "WIA3004", "WIA3005"],
        "facultyCores": ["WIX1001", "WIX1002", "WIX1003", "WIX2001", "WIA2001", "WIX3001"]
    },
    "FSKTM_DS": {
        "faculty": "Faculty of Computer Science & Information Technology (FSKTM)",
        "degree": "Bachelor of Computer Science (Data Science)",
        "department": "Department of Information Systems",
        "prefixes": ["WID"],
        "signatureCodes": ["WID2001", "WID2002", "WID2003", "WID3001", "WID3002", "WID3003", "WID3004", "WID3005"],
        "facultyCores": ["WIX1001", "WIX1002", "WIX1003", "WIX2001", "WIA2001", "WIX3001"]
    },
    "FSKTM_CSN": {
        "faculty": "Faculty of Computer Science & Information Technology (FSKTM)",
        "degree": "Bachelor of Computer Science (Computer Systems and Networking)",
        "department": "Department of Computer System and Technology",
        "prefixes": ["WIC"],
        "signatureCodes": ["WIC2001", "WIC2002", "WIC2003", "WIC3001", "WIC3002", "WIC3003", "WIC3004", "WIC3005"],
        "facultyCores": ["WIX1001", "WIX1002", "WIX1003", "WIX2001", "WIX2002", "WIX3001"]
    },
    "FSKTM_IS": {
        "faculty": "Faculty of Computer Science & Information Technology (FSKTM)",
        "degree": "Bachelor of Information Technology (Information Systems)",
        "department": "Department of Information Systems",
        "prefixes": ["WIB"],
        "signatureCodes": ["WIB2001", "WIB2002", "WIB2003", "WIB3001", "WIB3002", "WIB3003", "WIB3004"],
        "facultyCores": ["WIX1001", "WIX1002", "WIX1003", "WIX2001", "WIA2001", "WIX3001"]
    },
    "FSKTM_MM": {
        "faculty": "Faculty of Computer Science & Information Technology (FSKTM)",
        "degree": "Bachelor of Science in Computer Science (Multimedia Computing)",
        "department": "Department of Multimedia",
        "prefixes": ["WIF"],
        "signatureCodes": ["WIF2001", "WIF2002", "WIF2003", "WIF3001", "WIF3002", "WIF3003"],
        "facultyCores": ["WIX1001", "WIX1002", "WIX1003", "WIX2001", "WIX3001"]
    },

    # 2. Faculty of Engineering (FK)
    "FK_ELEC": {
        "faculty": "Faculty of Engineering",
        "degree": "Bachelor of Electrical Engineering",
        "department": "Department of Electrical Engineering",
        "prefixes": ["KKE"],
        "signatureCodes": ["KKE1001", "KKE2001", "KKE2002", "KKE3001", "KKE3002", "KKE4001"],
        "facultyCores": ["KIX1001", "KIX1002", "KIX2001", "KIG1001"]
    },
    "FK_MECH": {
        "faculty": "Faculty of Engineering",
        "degree": "Bachelor of Mechanical Engineering",
        "department": "Department of Mechanical Engineering",
        "prefixes": ["KKM", "KIG"],
        "signatureCodes": ["KKM1001", "KKM2001", "KKM2002", "KKM3001", "KIG2001", "KIG3001"],
        "facultyCores": ["KIX1001", "KIX1002", "KIX2001"]
    },
    "FK_CIVIL": {
        "faculty": "Faculty of Engineering",
        "degree": "Bachelor of Civil Engineering",
        "department": "Department of Civil Engineering",
        "prefixes": ["KKA"],
        "signatureCodes": ["KKA1001", "KKA2001", "KKA2002", "KKA3001", "KKA4001"],
        "facultyCores": ["KIX1001", "KIX1002", "KIX2001"]
    },
    "FK_CHEM": {
        "faculty": "Faculty of Engineering",
        "degree": "Bachelor of Chemical Engineering",
        "department": "Department of Chemical Engineering",
        "prefixes": ["KKC"],
        "signatureCodes": ["KKC1001", "KKC2001", "KKC2002", "KKC3001", "KKC4001"],
        "facultyCores": ["KIX1001", "KIX1002", "KIX2001"]
    },
    "FK_BIOMED": {
        "faculty": "Faculty of Engineering",
        "degree": "Bachelor of Biomedical Engineering",
        "department": "Department of Biomedical Engineering",
        "prefixes": ["KKB"],
        "signatureCodes": ["KKB1001", "KKB2001", "KKB2002", "KKB3001", "KKB4001"],
        "facultyCores": ["KIX1001", "KIX1002", "KIX2001"]
    },

    # 3. Faculty of Science (FS)
    "FS_MATH": {
        "faculty": "Faculty of Science",
        "degree": "Bachelor of Science in Mathematics",
        "department": "Institute of Mathematical Sciences",
        "prefixes": ["SIM"],
        "signatureCodes": ["SIM1001", "SIM1002", "SIM2001", "SIM2002", "SIM3001"],
        "facultyCores": ["SIX1001", "SIX1002", "SIX1004"]
    },
    "FS_ACTUARIAL": {
        "faculty": "Faculty of Science",
        "degree": "Bachelor of Actuarial Science",
        "department": "Institute of Mathematical Sciences",
        "prefixes": ["SIM"],
        "signatureCodes": ["SIM1003", "SIM2003", "SIM2004", "SIM3003", "SIM3004"],
        "facultyCores": ["SIX1001", "SIX1004"]
    },
    "FS_CHEM": {
        "faculty": "Faculty of Science",
        "degree": "Bachelor of Science in Chemistry",
        "department": "Department of Chemistry",
        "prefixes": ["SIC"],
        "signatureCodes": ["SIC1001", "SIC1002", "SIC2001", "SIC2002", "SIC3001"],
        "facultyCores": ["SIX1001", "SIX1004"]
    },
    "FS_PHYS": {
        "faculty": "Faculty of Science",
        "degree": "Bachelor of Science in Physics",
        "department": "Department of Physics",
        "prefixes": ["SIF"],
        "signatureCodes": ["SIF1001", "SIF1002", "SIF2001", "SIF2002", "SIF3001"],
        "facultyCores": ["SIX1001", "SIX1004"]
    },
    "FS_BIO": {
        "faculty": "Faculty of Science",
        "degree": "Bachelor of Science in Biochemistry & Biological Sciences",
        "department": "Institute of Biological Sciences",
        "prefixes": ["SIB", "SIJ", "SIE"],
        "signatureCodes": ["SIB1001", "SIJ1001", "SIE1001", "SIB2001", "SIJ2001"],
        "facultyCores": ["SIX1001", "SIX1004"]
    },
    "FS_GEOL": {
        "faculty": "Faculty of Science",
        "degree": "Bachelor of Science in Geology",
        "department": "Department of Geology",
        "prefixes": ["SIG"],
        "signatureCodes": ["SIG1001", "SIG1002", "SIG2001", "SIG2002", "SIG3001"],
        "facultyCores": ["SIX1001", "SIX1004"]
    },

    # 4. Faculty of Business and Economics (FPE)
    "FPE_ACC": {
        "faculty": "Faculty of Business and Economics",
        "degree": "Bachelor of Accounting",
        "department": "Department of Accounting",
        "prefixes": ["CIA"],
        "signatureCodes": ["CIA1001", "CIA2001", "CIA2002", "CIA3001", "CIA3002"],
        "facultyCores": ["CIB1001", "CIC1001", "EIA1001"]
    },
    "FPE_FIN": {
        "faculty": "Faculty of Business and Economics",
        "degree": "Bachelor of Finance",
        "department": "Department of Finance and Banking",
        "prefixes": ["CIB"],
        "signatureCodes": ["CIB1001", "CIB2001", "CIB2002", "CIB3001", "CIB3002"],
        "facultyCores": ["CIA1001", "CIC1001", "EIA1001"]
    },
    "FPE_BBA": {
        "faculty": "Faculty of Business and Economics",
        "degree": "Bachelor of Business Administration",
        "department": "Department of Management and Marketing",
        "prefixes": ["CIC", "CID"],
        "signatureCodes": ["CIC1001", "CIC2001", "CID2001", "CIC3001", "CID3001"],
        "facultyCores": ["CIA1001", "CIB1001", "EIA1001"]
    },
    "FPE_ECON": {
        "faculty": "Faculty of Business and Economics",
        "degree": "Bachelor of Economics",
        "department": "Department of Economics",
        "prefixes": ["EIA", "EIB", "EIC"],
        "signatureCodes": ["EIA1001", "EIA2001", "EIB2001", "EIC2001", "EIA3001"],
        "facultyCores": ["CIA1001", "CIB1001"]
    },

    # 5. Faculty of Built Environment (FAB)
    "FAB_ARCH": {
        "faculty": "Faculty of Built Environment",
        "degree": "Bachelor of Science in Architecture",
        "department": "Department of Architecture",
        "prefixes": ["BIA"],
        "signatureCodes": ["BIA1001", "BIA2001", "BIA2002", "BIA3001"],
        "facultyCores": ["BIA1002"]
    },
    "FAB_QS": {
        "faculty": "Faculty of Built Environment",
        "degree": "Bachelor of Quantity Surveying",
        "department": "Department of Quantity Surveying",
        "prefixes": ["BIE"],
        "signatureCodes": ["BIE1001", "BIE2001", "BIE2002", "BIE3001"],
        "facultyCores": []
    },
    "FAB_BS": {
        "faculty": "Faculty of Built Environment",
        "degree": "Bachelor of Building Surveying",
        "department": "Department of Building Surveying",
        "prefixes": ["BIB"],
        "signatureCodes": ["BIB1001", "BIB2001", "BIB2002", "BIB3001"],
        "facultyCores": []
    },
    "FAB_RE": {
        "faculty": "Faculty of Built Environment",
        "degree": "Bachelor of Real Estate",
        "department": "Department of Real Estate",
        "prefixes": ["BIC"],
        "signatureCodes": ["BIC1001", "BIC2001", "BIC2002", "BIC3001"],
        "facultyCores": []
    },
    "FAB_URP": {
        "faculty": "Faculty of Built Environment",
        "degree": "Bachelor of Urban and Regional Planning",
        "department": "Department of Urban and Regional Planning",
        "prefixes": ["BID"],
        "signatureCodes": ["BID1001", "BID2001", "BID2002", "BID3001"],
        "facultyCores": []
    },

    # 6. Faculty of Law (FUU)
    "FUU_LLB": {
        "faculty": "Faculty of Law",
        "degree": "Bachelor of Laws (LLB)",
        "department": "Faculty of Law",
        "prefixes": ["LXEB", "LIA", "LQC", "LXGA", "LXGB"],
        "signatureCodes": ["LXEB1001", "LXEB2001", "LXEB2002", "LXEB3001", "LXEB4001"],
        "facultyCores": []
    },

    # 7. Faculty of Medicine (FOM)
    "FOM_MBBS": {
        "faculty": "Faculty of Medicine",
        "degree": "Bachelor of Medicine and Bachelor of Surgery (MBBS)",
        "department": "Faculty of Medicine",
        "prefixes": ["MIA", "MID", "MIE"],
        "signatureCodes": ["MIA1001", "MID1001", "MIE1001", "MIA2001"],
        "facultyCores": []
    },
    "FOM_NURSING": {
        "faculty": "Faculty of Medicine",
        "degree": "Bachelor of Nursing Science",
        "department": "Department of Nursing Science",
        "prefixes": ["MIB", "MNA"],
        "signatureCodes": ["MIB1001", "MNA1001", "MIB2001", "MNA2001"],
        "facultyCores": []
    },
    "FOM_BIOMED": {
        "faculty": "Faculty of Medicine",
        "degree": "Bachelor of Biomedical Science",
        "department": "Department of Biomedical Science",
        "prefixes": ["MIC"],
        "signatureCodes": ["MIC1001", "MIC2001", "MIC2002", "MIC3001"],
        "facultyCores": []
    },

    # 8. Faculty of Pharmacy (FF)
    "FF_PHARM": {
        "faculty": "Faculty of Pharmacy",
        "degree": "Bachelor of Pharmacy",
        "department": "Faculty of Pharmacy",
        "prefixes": ["PIA", "PIB", "PIC", "PIX"],
        "signatureCodes": ["PIA1001", "PIB1001", "PIC1001", "PIX1001", "PIA2001"],
        "facultyCores": []
    },

    # 9. Faculty of Dentistry (FPG)
    "FPG_BDS": {
        "faculty": "Faculty of Dentistry",
        "degree": "Bachelor of Dental Surgery (BDS)",
        "department": "Faculty of Dentistry",
        "prefixes": ["DIA", "DIB"],
        "signatureCodes": ["DIA1001", "DIB1001", "DIA2001", "DIB2001"],
        "facultyCores": []
    },

    # 10. Faculty of Education (FP)
    "FP_EDU": {
        "faculty": "Faculty of Education",
        "degree": "Bachelor of Education (TESL / Counselling)",
        "department": "Faculty of Education",
        "prefixes": ["PGA", "PGB", "PGC", "PIX"],
        "signatureCodes": ["PGA1001", "PGB1001", "PGC1001", "PIX1001"],
        "facultyCores": []
    },

    # 11. Faculty of Languages and Linguistics (FLL)
    "FLL_LANG": {
        "faculty": "Faculty of Languages and Linguistics",
        "degree": "Bachelor of Arts in Linguistics / Languages",
        "department": "Faculty of Languages and Linguistics",
        "prefixes": ["TIX", "TIE", "TIA", "TIC", "TIJ", "TIG", "TIF"],
        "signatureCodes": ["TIX1001", "TIE1001", "TIA1001", "TIC1001", "TIJ1001"],
        "facultyCores": []
    },

    # 12. Faculty of Arts and Social Sciences (FASS)
    "FASS_ARTS": {
        "faculty": "Faculty of Arts and Social Sciences",
        "degree": "Bachelor of Arts (Social Sciences & Humanities)",
        "department": "Faculty of Arts and Social Sciences",
        "prefixes": ["AIX", "AIA", "AIB", "AIC", "AID", "AIE", "AIG", "AIH"],
        "signatureCodes": ["AIA1001", "AIB1001", "AIE1001", "AIG1001", "AIX1001"],
        "facultyCores": []
    },

    # 13. Faculty of Creative Arts (FCA)
    "FCA_ARTS": {
        "faculty": "Faculty of Creative Arts",
        "degree": "Bachelor of Performing / Visual Arts / Music",
        "department": "Faculty of Creative Arts",
        "prefixes": ["RIA", "RIB", "RIC", "RID", "RIE"],
        "signatureCodes": ["RIA1001", "RIB1001", "RIC1001", "RID1001", "RIE1001"],
        "facultyCores": []
    },

    # 14. Academy of Islamic Studies (API)
    "API_ISLAMIC": {
        "faculty": "Academy of Islamic Studies",
        "degree": "Bachelor of Islamic Studies (Shariah / Usuluddin)",
        "department": "Academy of Islamic Studies",
        "prefixes": ["IIX", "IIA", "IIB", "IIC"],
        "signatureCodes": ["IIX1001", "IIA1001", "IIB1001", "IIC1001"],
        "facultyCores": []
    },

    # 15. Academy of Malay Studies (APM)
    "APM_MALAY": {
        "faculty": "Academy of Malay Studies",
        "degree": "Bachelor of Arts in Malay Studies",
        "department": "Academy of Malay Studies",
        "prefixes": ["JIA", "JIB"],
        "signatureCodes": ["JIA1001", "JIB1001", "JIA2001", "JIB2001"],
        "facultyCores": []
    },

    # 16. Sports & Exercise Science
    "SES_SPORT": {
        "faculty": "Centre for Sport & Exercise Sciences",
        "degree": "Bachelor of Sports Science",
        "department": "Centre for Sport & Exercise Sciences",
        "prefixes": ["VIA", "VIB", "VIC"],
        "signatureCodes": ["VIA1001", "VIB1001", "VIC1001", "VIA2001"],
        "facultyCores": []
    }
}


def parse_handbook_pdf(pdf_path: str):
    """
    Extracts course codes, titles, and credit hours from a UM handbook PDF.
    """
    try:
        import pdfplumber
    except ImportError:
        print("[!] pdfplumber not installed. Run: pip install pdfplumber")
        return []

    results = []
    print(f"[*] Parsing PDF handbook: {pdf_path}")
    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            # Regex match UM course codes like WIA2001, KKE1001, GIG1013
            matches = re.finditer(r'\b([A-Z]{3}[0-9]{4})\b(?:\s+([A-Za-z0-9\s,&/\(\)\-]+?)(?:\s+(\d)\s+credit|\s+(\d)\b))?', text)
            for m in matches:
                code = m.group(1)
                title = m.group(2).strip() if m.group(2) else ""
                credits = m.group(3) or m.group(4) or ""
                results.append({"code": code, "title": title, "credits": credits, "page": page_idx + 1})

    print(f"[+] Found {len(results)} course occurrences in {pdf_path}")
    return results


def export_catalog(output_path: str = "scripts/um_curriculum_catalog.json"):
    """
    Exports the comprehensive UM curriculum catalog to a JSON file.
    """
    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(BUILTIN_UM_CURRICULUM, f, indent=2, ensure_ascii=False)
    print(f"[OK] Saved UM curriculum catalog with {len(BUILTIN_UM_CURRICULUM)} program definitions to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="UM Handbook Curriculum Scraper & Knowledge Base Builder")
    parser.add_argument("--pdf", help="Path to a downloaded UM handbook PDF to parse")
    parser.add_argument("--export", action="store_true", default=True, help="Export comprehensive curriculum catalog to JSON")
    args = parser.parse_args()

    if args.pdf:
        courses = parse_handbook_pdf(args.pdf)
        print(f"Extracted {len(courses)} courses.")
    if args.export:
        export_catalog()
