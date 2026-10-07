/**
 * UmSpec - SPeCTRUM Course Exporter (Nothing OS 4.0 Pro Edition)
 * Client-side browser extension for Universiti Malaya (UM) SPeCTRUM.
 */

(function () {
  'use strict';

  if (window.__umspec_injected) return;
  window.__umspec_injected = true;

  console.log('[UmSpec] Nothing OS 4.0 Pro Exporter initialized on SPeCTRUM');

  const SPEC_STACK_ICON = `<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <path fill="#fff" fill-rule="evenodd" d="M24 12h77q4 0 7 3l14 14q2 2 2 6v11q0 3-3 3H42l7 8h47q4 0 7 3l14 14q3 3 3 8v29q0 4-4 4H28q-4 0-7-3L8 99q-4-4-4-8v-8q0-3 4-3h77l-9-9H30q-4 0-7-3L10 55q-2-2-2-6V32q0-4 3-7l10-10q2-3 3-3Zm75 8v17h17L99 20Zm-3 45v16h16L96 65Z"/>
</svg>`;

  // State
  let detectedCourses = [];
  let selectedCourseIds = new Set();
  let studentProfile = null;
  let isExporting = false;
  let abortController = null;
  let runnerInstance = null;
  let sesskey = null;

  // Solid Glyph SVG Icons (SVGRepo Glyph Collection)
  const ICONS = {
    graduationCap: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2L1 7l11 5 9-4.09V17h2V7L12 2zm-7 8.18V16c0 3.31 3.13 6 7 6s7-2.69 7-6v-5.82l-7 3.18-7-3.18z"/></svg>`,
    bookOpen: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 1H5a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm-1 18H6V4h12v15zm-2-8H8v-2h8v2zm0-4H8V5h8v2z"/></svg>`,
    download: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    loader: `<svg class="umspec-svg umspec-spin" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10h-2.5A7.5 7.5 0 0 0 12 4.5V2z"/></svg>`,
    alertCircle: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    checkCircle: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
    close: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    folderArchive: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
    bolt: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>`,
    chevronDown: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`
  };

  // Official Chrome Dino Sprite Base64 Assets (Exact Chromium 1x Assets)
  const DINO_SPRITES = {
    trex: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQgAAAAvAgMAAABiRrxWAAAADFBMVEX///9TU1P39/f///+TS9URAAAAAXRSTlMAQObYZgAAAPpJREFUeF7d0jFKRkEMhdGLMM307itNLALyVmHvJuzTDMjdn72E95PGFEZSmeoU4YMMgxhskvQec8YSVFX1NhGcS5ywtbmC8khcZeKq+ZWJ4F8Sr2+ZCErjkJFEfcjAc/6/BMlfcz6xHdhRthYzIZhIHMcTVY1scUUiAphK8CMSPUbieTBhvD9Lj0vyV4wklEGzHpciKGOJoBp7XDcFs4kWxxM7Ey3iZ8JbzASAvMS7XLOJHTTvEkEZSeQl7DMuwVyCasqK5+XzQRYLUJlMbPXjFcn3m8eKBSjWZMJwvGIOvViAzCbUj1VEDoqFOEQGE3SyInJQLOQMJL4B7enP1UbLXJQAAAAASUVORK5CYII=",
    text: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAL8AAAAYAgMAAADWncTDAAAABlBMVEX///9TU1NYzE1OAAAAAXRSTlMAQObYZgAAAO1JREFUeF690TFqxUAQA1BNoRtk7jMu3E9Auv9Vgr/5A863Y9zEhVhkHmhZsEGkw4Lppmllh1tcLHx+aRj2YnEDuQFvcQW+EoZY0TQLCZbEVxRxAvY+i8ikW0C0bwFdbictG2zvu/4EcCuBF0B23IBsQHZBYgm1n86BN+BmyV5rQFyCJAiDJSTfgBV9BbjvXdzIcKchpMOYd3gO/jvCeuUGFALg95J0/SrtQlrzz+sAjDwCIQsbWAdgbqrQpKYRjmPuAfU5dMC+c0rxOTiO+T6ZlK4pbcDLI1DIRaf3GxDGALkQHnD+cGhMKeox+AEOL3mLO7TQZgAAAABJRU5ErkJggg==",
    restart: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAgCAQAAADQmBIFAAAAZklEQVR4Xu3WMQoAIAxDUe/Y+58jYwV1CwQJWQT5o/DAoaWjV2i/LRym/A5FjEsR41LPQchByEHwIVAEC4gZpghmSDP8egXpr/hQZaAKQFQe+pBOQAblDC336qrlPpSg0MEjInbWTLFFmwc8TpTAAAAAAElFTkSuQmCC",
    cactusSmall: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGYAAAAjCAMAAABRlI+PAAAADFBMVEX////////39/dTU1PhglcSAAAAAXRSTlMAQObYZgAAAPNJREFUeF7tlkEKwzAMBLXr//+5iQhU7gRRQkyhZI+DhwH74jhmO+oIJBVwURljuAXagG5QqkSgBLqg3JnxJ1Cb8SmQ3o6gpO85owGlOB4m2BNKJ11BSd01owGlOHkcIAuHkz6UNpPKgozPM54dADHjJuNhZiJxdQCQgZJeBczgCAAy3yhPJvcnmdC9mZwBIsQMFV5AkzHBNknFgcKM+oyDIFcfCAoy03m+jSMIcmoVZkKqSjr1fghyahRmoKRUHYLiSI1SMlCq5CDgX6BXmKkfn+oQ0KEyyrzoy8GbXJ9xrM/YjhUZgl9nnsyTCe9rgSRdV15CwRcIEu8GGQAAAABJRU5ErkJggg==",
    cactusLarge: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAAAyCAMAAACJUtIoAAAACVBMVEX////39/dTU1OabbyfAAAAAXRSTlMAQObYZgAAAXhJREFUeF7t2NGqAjEMANGM///RlwvaYQndULuFPJgHUYaEI6IPhgNAOA8HZ+3U6384F5y1U6YzAZTWG+dZamnFEstBFtCKJZSHWMADLJ18z+JqpQeLdKoDC8siC5iFCQs4znIxB5B1t6F3lQWkL4N0JsF+u6GXJdbI+FKW+yWr3lhgCZ2VSag3Nlk/FnRkIRbasLCO0oulikMsvmGpeiGLZ1jOMgtIP5bODivYYUXEIVbwFCt4khVssRgsgidZwQaLd2A8m7MYLGTl4KeQQs2y4kMAMGGlmQViDIb5O6xZnnLD485dIBzqDSE1yyFdL4Iqu4XJqUUWl/NVAFSZq1P6a5aqbAUM2epQbBioWflUBABiUyhYyZoCBev8XyMAObDNOhOAfiyxmHU0YNlldGAphGjFCjA3YkUn1o/1Y3EkZFZ5isCC6NUgwDBn1RuXH96doNfAhDXfsIyJ2AnolcCVhay0kcYbW0HvCO8OwIcJ3GzkORpkFuUP/1Ec8FW1qJkAAAAASUVORK5CYII="
  };

  // Helper: Sanitize folder/file names
  function sanitizeName(name) {
    if (!name) return 'unnamed';
    return name
      .replace(/[\\/*?:"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  // Helper: Extract clean course folder name
  function formatCourseFolder(fullName, shortName) {
    const raw = fullName || shortName || 'Course Materials';
    const codeMatch = raw.match(/([A-Z]{3}\d{4})/i) || (shortName || '').match(/([A-Z]{3}\d{4})/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : '';

    let title = raw
      .replace(/[A-Z]{3}\d{4}(?:\s*\/\s*[A-Z]{3}\d{4})*/gi, ' ')
      .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
      .replace(/\b(sem(?:ester)?\s*\d+|20\d\d\s*\/\s*20\d\d|occ\s*\d+|sec(?:tion)?\s*\d+|kumpulan\s*\d+)\b/gi, ' ')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const titleWords = title
      .split(' ')
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

    const cleanTitle = titleWords.join(' ') || 'Course Materials';
    return sanitizeName(code ? `${code} ${cleanTitle}` : cleanTitle);
  }

  // Comprehensive UM Multi-Faculty Curriculum Knowledge Base (All 16 UM Faculties)
  const UM_CURRICULUM_CATALOG = {
    // 1. Faculty of Computer Science & Information Technology (FSKTM)
    'FSKTM_AI': {
      faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
      degree: 'Bachelor of Computer Science (Artificial Intelligence)',
      prefixes: ['WIE'],
      signatureCodes: ['WIE2001', 'WIE2002', 'WIE2003', 'WIE3001', 'WIE3002', 'WIE3003', 'WIE3004'],
      facultyPrefix: 'WI'
    },
    'FSKTM_SE': {
      faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
      degree: 'Bachelor of Computer Science (Software Engineering)',
      prefixes: ['WIA'],
      signatureCodes: ['WIA2003', 'WIA2004', 'WIA2005', 'WIA3001', 'WIA3002', 'WIA3003', 'WIA3004'],
      facultyPrefix: 'WI'
    },
    'FSKTM_DS': {
      faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
      degree: 'Bachelor of Computer Science (Data Science)',
      prefixes: ['WID'],
      signatureCodes: ['WID2001', 'WID2002', 'WID2003', 'WID3001', 'WID3002', 'WID3003'],
      facultyPrefix: 'WI'
    },
    'FSKTM_CSN': {
      faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
      degree: 'Bachelor of Computer Science (Computer Systems and Networking)',
      prefixes: ['WIC'],
      signatureCodes: ['WIC2001', 'WIC2002', 'WIC2003', 'WIC3001', 'WIC3002', 'WIC3003'],
      facultyPrefix: 'WI'
    },
    'FSKTM_IS': {
      faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
      degree: 'Bachelor of Information Technology (Information Systems)',
      prefixes: ['WIB'],
      signatureCodes: ['WIB2001', 'WIB2002', 'WIB2003', 'WIB3001', 'WIB3002', 'WIB3003'],
      facultyPrefix: 'WI'
    },
    'FSKTM_MM': {
      faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
      degree: 'Bachelor of Science in Computer Science (Multimedia Computing)',
      prefixes: ['WIF'],
      signatureCodes: ['WIF2001', 'WIF2002', 'WIF2003', 'WIF3001', 'WIF3002'],
      facultyPrefix: 'WI'
    },

    // 2. Faculty of Engineering (FK)
    'FK_ELEC': {
      faculty: 'Faculty of Engineering',
      degree: 'Bachelor of Electrical Engineering',
      prefixes: ['KKE'],
      signatureCodes: ['KKE1001', 'KKE2001', 'KKE2002', 'KKE3001', 'KKE3002', 'KKE4001'],
      facultyPrefix: 'KK'
    },
    'FK_MECH': {
      faculty: 'Faculty of Engineering',
      degree: 'Bachelor of Mechanical Engineering',
      prefixes: ['KKM', 'KIG'],
      signatureCodes: ['KKM1001', 'KKM2001', 'KKM2002', 'KKM3001', 'KIG2001', 'KIG3001'],
      facultyPrefix: 'KK'
    },
    'FK_CIVIL': {
      faculty: 'Faculty of Engineering',
      degree: 'Bachelor of Civil Engineering',
      prefixes: ['KKA'],
      signatureCodes: ['KKA1001', 'KKA2001', 'KKA2002', 'KKA3001', 'KKA4001'],
      facultyPrefix: 'KK'
    },
    'FK_CHEM': {
      faculty: 'Faculty of Engineering',
      degree: 'Bachelor of Chemical Engineering',
      prefixes: ['KKC'],
      signatureCodes: ['KKC1001', 'KKC2001', 'KKC2002', 'KKC3001', 'KKC4001'],
      facultyPrefix: 'KK'
    },
    'FK_BIOMED': {
      faculty: 'Faculty of Engineering',
      degree: 'Bachelor of Biomedical Engineering',
      prefixes: ['KKB'],
      signatureCodes: ['KKB1001', 'KKB2001', 'KKB2002', 'KKB3001', 'KKB4001'],
      facultyPrefix: 'KK'
    },

    // 3. Faculty of Science (FS)
    'FS_MATH': {
      faculty: 'Faculty of Science',
      degree: 'Bachelor of Science in Mathematics',
      prefixes: ['SIM'],
      signatureCodes: ['SIM1001', 'SIM1002', 'SIM2001', 'SIM2002', 'SIM3001'],
      facultyPrefix: 'SI'
    },
    'FS_ACTUARIAL': {
      faculty: 'Faculty of Science',
      degree: 'Bachelor of Actuarial Science',
      prefixes: ['SIM'],
      signatureCodes: ['SIM1003', 'SIM2003', 'SIM2004', 'SIM3003', 'SIM3004'],
      facultyPrefix: 'SI'
    },
    'FS_CHEM': {
      faculty: 'Faculty of Science',
      degree: 'Bachelor of Science in Chemistry',
      prefixes: ['SIC'],
      signatureCodes: ['SIC1001', 'SIC1002', 'SIC2001', 'SIC2002', 'SIC3001'],
      facultyPrefix: 'SI'
    },
    'FS_PHYS': {
      faculty: 'Faculty of Science',
      degree: 'Bachelor of Science in Physics',
      prefixes: ['SIF'],
      signatureCodes: ['SIF1001', 'SIF1002', 'SIF2001', 'SIF2002', 'SIF3001'],
      facultyPrefix: 'SI'
    },
    'FS_BIO': {
      faculty: 'Faculty of Science',
      degree: 'Bachelor of Science in Biological Sciences & Biochemistry',
      prefixes: ['SIB', 'SIJ', 'SIE'],
      signatureCodes: ['SIB1001', 'SIJ1001', 'SIE1001', 'SIB2001', 'SIJ2001'],
      facultyPrefix: 'SI'
    },
    'FS_GEOL': {
      faculty: 'Faculty of Science',
      degree: 'Bachelor of Science in Geology',
      prefixes: ['SIG'],
      signatureCodes: ['SIG1001', 'SIG1002', 'SIG2001', 'SIG2002', 'SIG3001'],
      facultyPrefix: 'SI'
    },

    // 4. Faculty of Business and Economics (FPE)
    'FPE_ACC': {
      faculty: 'Faculty of Business and Economics',
      degree: 'Bachelor of Accounting',
      prefixes: ['CIA'],
      signatureCodes: ['CIA1001', 'CIA2001', 'CIA2002', 'CIA3001', 'CIA3002'],
      facultyPrefix: 'CI'
    },
    'FPE_FIN': {
      faculty: 'Faculty of Business and Economics',
      degree: 'Bachelor of Finance',
      prefixes: ['CIB'],
      signatureCodes: ['CIB1001', 'CIB2001', 'CIB2002', 'CIB3001', 'CIB3002'],
      facultyPrefix: 'CI'
    },
    'FPE_BBA': {
      faculty: 'Faculty of Business and Economics',
      degree: 'Bachelor of Business Administration',
      prefixes: ['CIC', 'CID'],
      signatureCodes: ['CIC1001', 'CIC2001', 'CID2001', 'CIC3001', 'CID3001'],
      facultyPrefix: 'CI'
    },
    'FPE_ECON': {
      faculty: 'Faculty of Business and Economics',
      degree: 'Bachelor of Economics',
      prefixes: ['EIA', 'EIB', 'EIC'],
      signatureCodes: ['EIA1001', 'EIA2001', 'EIB2001', 'EIC2001', 'EIA3001'],
      facultyPrefix: 'EI'
    },

    // 5. Faculty of Built Environment (FAB)
    'FAB_ARCH': {
      faculty: 'Faculty of Built Environment',
      degree: 'Bachelor of Science in Architecture',
      prefixes: ['BIA'],
      signatureCodes: ['BIA1001', 'BIA2001', 'BIA2002', 'BIA3001'],
      facultyPrefix: 'BI'
    },
    'FAB_QS': {
      faculty: 'Faculty of Built Environment',
      degree: 'Bachelor of Quantity Surveying',
      prefixes: ['BIE'],
      signatureCodes: ['BIE1001', 'BIE2001', 'BIE2002', 'BIE3001'],
      facultyPrefix: 'BI'
    },
    'FAB_BS': {
      faculty: 'Faculty of Built Environment',
      degree: 'Bachelor of Building Surveying',
      prefixes: ['BIB'],
      signatureCodes: ['BIB1001', 'BIB2001', 'BIB2002', 'BIB3001'],
      facultyPrefix: 'BI'
    },
    'FAB_RE': {
      faculty: 'Faculty of Built Environment',
      degree: 'Bachelor of Real Estate',
      prefixes: ['BIC'],
      signatureCodes: ['BIC1001', 'BIC2001', 'BIC2002', 'BIC3001'],
      facultyPrefix: 'BI'
    },
    'FAB_URP': {
      faculty: 'Faculty of Built Environment',
      degree: 'Bachelor of Urban and Regional Planning',
      prefixes: ['BID'],
      signatureCodes: ['BID1001', 'BID2001', 'BID2002', 'BID3001'],
      facultyPrefix: 'BI'
    },

    // 6. Faculty of Law (FUU)
    'FUU_LLB': {
      faculty: 'Faculty of Law',
      degree: 'Bachelor of Laws (LLB)',
      prefixes: ['LXEB', 'LIA', 'LQC', 'LXGA', 'LXGB'],
      signatureCodes: ['LXEB1001', 'LXEB2001', 'LXEB2002', 'LXEB3001', 'LXEB4001'],
      facultyPrefix: 'LX'
    },

    // 7. Faculty of Medicine (FOM)
    'FOM_MBBS': {
      faculty: 'Faculty of Medicine',
      degree: 'Bachelor of Medicine and Bachelor of Surgery (MBBS)',
      prefixes: ['MIA', 'MID', 'MIE'],
      signatureCodes: ['MIA1001', 'MID1001', 'MIE1001', 'MIA2001'],
      facultyPrefix: 'MI'
    },
    'FOM_NURSING': {
      faculty: 'Faculty of Medicine',
      degree: 'Bachelor of Nursing Science',
      prefixes: ['MIB', 'MNA'],
      signatureCodes: ['MIB1001', 'MNA1001', 'MIB2001', 'MNA2001'],
      facultyPrefix: 'MI'
    },
    'FOM_BIOMED': {
      faculty: 'Faculty of Medicine',
      degree: 'Bachelor of Biomedical Science',
      prefixes: ['MIC'],
      signatureCodes: ['MIC1001', 'MIC2001', 'MIC2002', 'MIC3001'],
      facultyPrefix: 'MI'
    },

    // 8. Faculty of Pharmacy (FF)
    'FF_PHARM': {
      faculty: 'Faculty of Pharmacy',
      degree: 'Bachelor of Pharmacy',
      prefixes: ['PIA', 'PIB', 'PIC', 'PIX'],
      signatureCodes: ['PIA1001', 'PIB1001', 'PIC1001', 'PIX1001', 'PIA2001'],
      facultyPrefix: 'PI'
    },

    // 9. Faculty of Dentistry (FPG)
    'FPG_BDS': {
      faculty: 'Faculty of Dentistry',
      degree: 'Bachelor of Dental Surgery (BDS)',
      prefixes: ['DIA', 'DIB'],
      signatureCodes: ['DIA1001', 'DIB1001', 'DIA2001', 'DIB2001'],
      facultyPrefix: 'DI'
    },

    // 10. Faculty of Education (FP)
    'FP_EDU': {
      faculty: 'Faculty of Education',
      degree: 'Bachelor of Education (TESL / Counselling)',
      prefixes: ['PGA', 'PGB', 'PGC', 'PIX'],
      signatureCodes: ['PGA1001', 'PGB1001', 'PGC1001', 'PIX1001'],
      facultyPrefix: 'PG'
    },

    // 11. Faculty of Languages and Linguistics (FLL)
    'FLL_LANG': {
      faculty: 'Faculty of Languages and Linguistics',
      degree: 'Bachelor of Arts in Linguistics / Languages',
      prefixes: ['TIX', 'TIE', 'TIA', 'TIC', 'TIJ', 'TIG', 'TIF'],
      signatureCodes: ['TIX1001', 'TIE1001', 'TIA1001', 'TIC1001', 'TIJ1001'],
      facultyPrefix: 'TI'
    },

    // 12. Faculty of Arts and Social Sciences (FASS)
    'FASS_ARTS': {
      faculty: 'Faculty of Arts and Social Sciences',
      degree: 'Bachelor of Arts (Social Sciences & Humanities)',
      prefixes: ['AIX', 'AIA', 'AIB', 'AIC', 'AID', 'AIE', 'AIG', 'AIH'],
      signatureCodes: ['AIA1001', 'AIB1001', 'AIE1001', 'AIG1001', 'AIX1001'],
      facultyPrefix: 'AI'
    },

    // 13. Faculty of Creative Arts (FCA)
    'FCA_ARTS': {
      faculty: 'Faculty of Creative Arts',
      degree: 'Bachelor of Performing / Visual Arts / Music',
      prefixes: ['RIA', 'RIB', 'RIC', 'RID', 'RIE'],
      signatureCodes: ['RIA1001', 'RIB1001', 'RIC1001', 'RID1001', 'RIE1001'],
      facultyPrefix: 'RI'
    },

    // 14. Academy of Islamic Studies (API)
    'API_ISLAMIC': {
      faculty: 'Academy of Islamic Studies',
      degree: 'Bachelor of Islamic Studies (Shariah / Usuluddin)',
      prefixes: ['IIX', 'IIA', 'IIB', 'IIC'],
      signatureCodes: ['IIX1001', 'IIA1001', 'IIB1001', 'IIC1001'],
      facultyPrefix: 'II'
    },

    // 15. Academy of Malay Studies (APM)
    'APM_MALAY': {
      faculty: 'Academy of Malay Studies',
      degree: 'Bachelor of Arts in Malay Studies',
      prefixes: ['JIA', 'JIB'],
      signatureCodes: ['JIA1001', 'JIB1001', 'JIA2001', 'JIB2001'],
      facultyPrefix: 'JI'
    },

    // 16. Sports & Exercise Science (SES)
    'SES_SPORT': {
      faculty: 'Centre for Sport & Exercise Sciences',
      degree: 'Bachelor of Sports Science',
      prefixes: ['VIA', 'VIB', 'VIC'],
      signatureCodes: ['VIA1001', 'VIB1001', 'VIC1001', 'VIA2001'],
      facultyPrefix: 'VI'
    }
  };

  // Department / Faculty Keyword to Standard Degree & Faculty Mapper
  function mapDepartmentToDegree(text) {
    if (!text) return null;
    const t = text.toLowerCase();

    // 1. Computing / FSKTM
    if (t.includes('artificial intelligence') || t.includes('kecerdasan buatan')) {
      return { degree: 'Bachelor of Computer Science (Artificial Intelligence)', faculty: 'Faculty of Computer Science & Information Technology (FSKTM)' };
    }
    if (t.includes('software engineering') || t.includes('kejuruteraan perisian')) {
      return { degree: 'Bachelor of Computer Science (Software Engineering)', faculty: 'Faculty of Computer Science & Information Technology (FSKTM)' };
    }
    if (t.includes('data science') || t.includes('sains data')) {
      return { degree: 'Bachelor of Computer Science (Data Science)', faculty: 'Faculty of Computer Science & Information Technology (FSKTM)' };
    }
    if (t.includes('computer system') || t.includes('networking') || t.includes('sistem komputer') || t.includes('rangkaian')) {
      return { degree: 'Bachelor of Computer Science (Computer Systems and Networking)', faculty: 'Faculty of Computer Science & Information Technology (FSKTM)' };
    }
    if (t.includes('information system') || t.includes('sistem maklumat')) {
      return { degree: 'Bachelor of Information Technology (Information Systems)', faculty: 'Faculty of Computer Science & Information Technology (FSKTM)' };
    }
    if (t.includes('multimedia')) {
      return { degree: 'Bachelor of Science in Computer Science (Multimedia Computing)', faculty: 'Faculty of Computer Science & Information Technology (FSKTM)' };
    }

    // 2. Engineering
    if (t.includes('electrical') || t.includes('elektrik')) {
      return { degree: 'Bachelor of Electrical Engineering', faculty: 'Faculty of Engineering' };
    }
    if (t.includes('mechanical') || t.includes('mekanikal')) {
      return { degree: 'Bachelor of Mechanical Engineering', faculty: 'Faculty of Engineering' };
    }
    if (t.includes('civil') || t.includes('awam')) {
      return { degree: 'Bachelor of Civil Engineering', faculty: 'Faculty of Engineering' };
    }
    if (t.includes('chemical') || t.includes('kimia') && t.includes('kejuruteraan')) {
      return { degree: 'Bachelor of Chemical Engineering', faculty: 'Faculty of Engineering' };
    }
    if (t.includes('biomedical') || t.includes('bioperubatan')) {
      return { degree: 'Bachelor of Biomedical Engineering', faculty: 'Faculty of Engineering' };
    }

    // 3. Business & Economics
    if (t.includes('accounting') || t.includes('perakaunan')) {
      return { degree: 'Bachelor of Accounting', faculty: 'Faculty of Business and Economics' };
    }
    if (t.includes('finance') || t.includes('kewangan')) {
      return { degree: 'Bachelor of Finance', faculty: 'Faculty of Business and Economics' };
    }
    if (t.includes('business') || t.includes('perniagaan') || t.includes('pentadbiran perniagaan')) {
      return { degree: 'Bachelor of Business Administration', faculty: 'Faculty of Business and Economics' };
    }
    if (t.includes('economics') || t.includes('ekonomi')) {
      return { degree: 'Bachelor of Economics', faculty: 'Faculty of Business and Economics' };
    }

    // 4. Science
    if (t.includes('actuarial') || t.includes('aktuari')) {
      return { degree: 'Bachelor of Actuarial Science', faculty: 'Faculty of Science' };
    }
    if (t.includes('mathematics') || t.includes('matematik')) {
      return { degree: 'Bachelor of Science in Mathematics', faculty: 'Faculty of Science' };
    }
    if (t.includes('physics') || t.includes('fizik')) {
      return { degree: 'Bachelor of Science in Physics', faculty: 'Faculty of Science' };
    }
    if (t.includes('chemistry') || t.includes('kimia')) {
      return { degree: 'Bachelor of Science in Chemistry', faculty: 'Faculty of Science' };
    }

    // 5. Law & Medicine
    if (t.includes('law') || t.includes('undang')) {
      return { degree: 'Bachelor of Laws (LLB)', faculty: 'Faculty of Law' };
    }
    if (t.includes('medicine') || t.includes('perubatan') || t.includes('mbbs')) {
      return { degree: 'Bachelor of Medicine and Bachelor of Surgery (MBBS)', faculty: 'Faculty of Medicine' };
    }
    if (t.includes('pharmacy') || t.includes('farmasi')) {
      return { degree: 'Bachelor of Pharmacy', faculty: 'Faculty of Pharmacy' };
    }
    if (t.includes('dentistry') || t.includes('pergigian')) {
      return { degree: 'Bachelor of Dental Surgery (BDS)', faculty: 'Faculty of Dentistry' };
    }

    return null;
  }

  // Calculate Average Academic Year and Active Semester
  function calculateYearSemester(courses) {
    const validLevels = courses.map(c => {
      const m = c.fullName.match(/\b[A-Z]{3,4}(\d)\d{3}\b/i);
      return m ? parseInt(m[1]) : null;
    }).filter(lvl => lvl && lvl >= 1 && lvl <= 5);

    let inferredYear = 1;
    if (validLevels.length) {
      const counts = {};
      validLevels.forEach(lvl => { counts[lvl] = (counts[lvl] || 0) + 1; });
      inferredYear = parseInt(Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b));
    }

    // UM Academic Calendar Semester Inference
    // Sem 1: October to February | Sem 2: March to July | Special Sem: August to September
    const month = new Date().getMonth() + 1;
    let semStr = 'Semester 1';
    if (month >= 3 && month <= 7) {
      semStr = 'Semester 2';
    } else if (month >= 8 && month <= 9) {
      semStr = 'Special Semester';
    } else {
      semStr = 'Semester 1';
    }

    return `Year ${inferredYear}, ${semStr}`;
  }

  // Multi-Source Integrated Academic Profile Detection Pipeline
  async function detectAcademicProfile(courses, userName) {
    // 1. Saved user preference takes absolute priority
    const savedDegree = localStorage.getItem('umspec_saved_degree');
    if (savedDegree) {
      let faculty = 'Universiti Malaya';
      for (const key of Object.keys(UM_CURRICULUM_CATALOG)) {
        if (UM_CURRICULUM_CATALOG[key].degree === savedDegree) {
          faculty = UM_CURRICULUM_CATALOG[key].faculty;
          break;
        }
      }
      return {
        studentName: userName || 'UM Student',
        faculty: faculty,
        bachelor: savedDegree,
        yearSem: calculateYearSemester(courses),
        totalCourses: courses.length,
        detectionSource: 'Saved User Preference'
      };
    }

    let detectedBachelor = null;
    let detectedFaculty = 'Universiti Malaya';
    let detectionSource = 'UM Multi-Faculty Curriculum Engine';

    // 2. Query SPeCTRUM User Profile API if session is active
    const currentSesskey = getSesskey();
    if (currentSesskey) {
      try {
        const userId = window.M?.cfg?.userId || document.querySelector('a[href*="/user/profile.php?id="], a[href*="/user/view.php?id="]')?.href?.match(/id=(\d+)/)?.[1];
        if (userId) {
          const apiRes = await fetch(`https://spectrum.um.edu.my/lib/ajax/service.php?sesskey=${currentSesskey}&info=core_user_get_users_by_field`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ index: 0, methodname: 'core_user_get_users_by_field', args: { field: 'id', values: [parseInt(userId)] } }])
          });
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            const u = apiData[0]?.data?.[0];
            if (u) {
              const deptDegree = mapDepartmentToDegree(u.department) || mapDepartmentToDegree(u.institution);
              if (deptDegree) {
                detectedBachelor = deptDegree.degree;
                detectedFaculty = deptDegree.faculty;
                detectionSource = 'SPeCTRUM Profile API';
              } else if (u.department) {
                detectedFaculty = u.department;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[UmSpec] User profile API fallback:', e);
      }
    }

    // 3. Multi-Faculty Weighted Bayesian Curriculum Inference
    if (!detectedBachelor) {
      const scores = {};
      for (const progKey of Object.keys(UM_CURRICULUM_CATALOG)) {
        scores[progKey] = 0;
      }

      courses.forEach(c => {
        const titleUpper = c.fullName.toUpperCase();
        const match = titleUpper.match(/\b([A-Z]{3,4})([0-9]{4})\b/);
        if (!match) return;

        const fullCode = match[0];
        const prefix = match[1];

        // Filter general university courses so they don't skew degree classification
        if (['GIG', 'GLT', 'GQX', 'GKN', 'GKA'].includes(prefix)) {
          return;
        }

        // Score against every curriculum program in UM
        for (const [progKey, prog] of Object.entries(UM_CURRICULUM_CATALOG)) {
          // Exact signature specialization core (e.g. WIE2001 in AI, KKE1001 in Electrical) = 10 pts
          if (prog.signatureCodes && prog.signatureCodes.includes(fullCode)) {
            scores[progKey] += 10;
          }
          // Department prefix match (e.g. WIE in AI, CIA in Accounting) = 6 pts
          else if (prog.prefixes && prog.prefixes.includes(prefix)) {
            scores[progKey] += 6;
          }
          // Faculty-wide prefix match (e.g. WIX in FSKTM, KIX in FK, SIX in FS) = 2 pts
          else if (prog.facultyPrefix && prefix.startsWith(prog.facultyPrefix)) {
            scores[progKey] += 2;
          }
        }
      });

      // Find best-matching degree programme
      let bestProgKey = null;
      let highestScore = 0;
      for (const [key, score] of Object.entries(scores)) {
        if (score > highestScore) {
          highestScore = score;
          bestProgKey = key;
        }
      }

      if (bestProgKey && highestScore > 0) {
        const best = UM_CURRICULUM_CATALOG[bestProgKey];
        detectedBachelor = best.degree;
        detectedFaculty = best.faculty;
        detectionSource = 'Curriculum Matrix Inference';
      }
    }

    // Default fallback if only university electives enrolled
    if (!detectedBachelor) {
      detectedBachelor = 'Bachelor of Computer Science (Software Engineering)';
      detectedFaculty = 'Faculty of Computer Science & Information Technology (FSKTM)';
      detectionSource = 'Standard UM Default';
    }

    return {
      studentName: userName || 'UM Student',
      faculty: detectedFaculty,
      bachelor: detectedBachelor,
      yearSem: calculateYearSemester(courses),
      totalCourses: courses.length,
      detectionSource: detectionSource
    };
  }

  // Adaptive Taxonomy Classification
  function classifyAdaptiveCategory(actName, secName, ext) {
    const text = `${actName} ${secName}`.toLowerCase();
    const e = (ext || '').toLowerCase();

    if (text.includes('past year') || text.includes('pyq') || text.includes('exam') || text.includes('peperiksaan') || text.includes('sample paper') || text.includes('mid term') || text.includes('midterm') || text.includes('test')) {
      return { id: '4.Past Year Questions', label: 'Past Year & Tests' };
    }
    if (text.includes('tutorial') || text.includes('exercise') || text.includes('latihan') || text.includes('worksheet') || text.includes('tuto')) {
      return { id: '2.Tutorials', label: 'Tutorials' };
    }
    if (text.includes('lab') || text.includes('practical') || text.includes('amali') || text.includes('hands-on')) {
      return { id: '3.Lab Materials', label: 'Labs' };
    }
    if (text.includes('assignment') || text.includes('project') || text.includes('tugasan') || text.includes('rubric') || text.includes('milestone')) {
      return { id: '5.Assignments & Projects', label: 'Assignments' };
    }
    if (text.includes('lecture') || text.includes('slide') || text.includes('kuliah') || text.includes('topic') || text.includes('week') || text.includes('nota') || text.includes('notes') || text.includes('chapter') || text.includes('unit')) {
      return { id: '1.Lecture Slide', label: 'Lecture Slides' };
    }
    if (['.py', '.java', '.c', '.cpp', '.sql', '.html', '.js', '.css', '.ipynb', '.dart', '.kt', '.php'].includes(e) || text.includes('source code') || text.includes('script') || text.includes('code')) {
      return { id: '6.Source Code & References', label: 'Source Code' };
    }
    if (['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.webm'].includes(e) || text.includes('recording') || text.includes('video') || text.includes('webinar')) {
      return { id: '7.Recordings & Media', label: 'Media & Videos' };
    }
    return { id: '1.Lecture Slide', label: 'General Course Materials' };
  }

  // Get SPeCTRUM sesskey
  function getSesskey() {
    if (sesskey) return sesskey;
    if (window.M?.cfg?.sesskey) {
      sesskey = window.M.cfg.sesskey;
      return sesskey;
    }
    const logoutLink = document.querySelector('a[href*="logout.php?sesskey="]');
    if (logoutLink) {
      const match = logoutLink.href.match(/sesskey=([a-zA-Z0-9]+)/);
      if (match) {
        sesskey = match[1];
        return sesskey;
      }
    }
    const input = document.querySelector('input[name="sesskey"]');
    if (input) {
      sesskey = input.value;
      return sesskey;
    }
    return null;
  }

  // Discover Enrolled Courses
  async function discoverCourses() {
    const courses = [];
    const seen = new Set();
    const currentSesskey = getSesskey();

    if (currentSesskey) {
      try {
        const res = await fetch(`https://spectrum.um.edu.my/lib/ajax/service.php?sesskey=${currentSesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            index: 0,
            methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
            args: { classification: 'all', limit: 0, offset: 0, sort: 'fullname' }
          }])
        });
        if (res.ok) {
          const data = await res.json();
          const list = data[0]?.data?.courses || [];
          list.forEach(c => {
            if (!seen.has(c.id) && c.id > 1) {
              seen.add(c.id);
              courses.push({
                id: c.id,
                fullName: c.fullname,
                shortName: c.shortname,
                folderName: formatCourseFolder(c.fullname, c.shortname),
                url: `https://spectrum.um.edu.my/course/view.php?id=${c.id}`
              });
            }
          });
        }
      } catch (e) {
        console.warn('[UmSpec] SPeCTRUM timeline classification API fallback:', e);
      }
    }

    if (courses.length === 0) {
      document.querySelectorAll('a[href*="/course/view.php?id="]').forEach(a => {
        const match = a.href.match(/[?&]id=(\d+)/);
        if (match) {
          const id = parseInt(match[1]);
          if (!seen.has(id) && id > 1) {
            seen.add(id);
            const text = a.innerText.trim();
            const title = a.getAttribute('title') || text;
            courses.push({
              id: id,
              fullName: title || `Course ${id}`,
              shortName: text || `Course ${id}`,
              folderName: formatCourseFolder(title, text),
              url: a.href
            });
          }
        }
      });
    }

    const userEl = document.querySelector('.usertext, .usermenu, .user-name');
    const userName = userEl ? userEl.innerText.trim() : 'UM Student';
    studentProfile = await detectAcademicProfile(courses, userName);

    return courses;
  }

  // ==========================================================================
  // Official Chrome Dino Engine (Identical to Native Chrome T-Rex Runner)
  // Supports RUNNING, GAME OVER with [⟳] Restart, and SUCCESS completion
  // ==========================================================================
  function loadInvertedImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
          const imgData = ctx.getImageData(0, 0, off.width, off.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 10) {
              d[i] = Math.min(255, (255 - d[i]) * 1.5);
              d[i + 1] = Math.min(255, (255 - d[i + 1]) * 1.5);
              d[i + 2] = Math.min(255, (255 - d[i + 2]) * 1.5);
            }
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(off);
        } catch (e) {
          resolve(img);
        }
      };
      img.src = src;
    });
  }

  class UmSpecDragonRunner {
    constructor(canvas, scoreEl) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.scoreEl = scoreEl;
      this.state = 'IDLE'; // 'IDLE' | 'RUNNING' | 'GAME_OVER' | 'SUCCESS'
      this.score = 0;
      this.highScore = '00055';
      this.speed = 4.2;
      this.groundY = 94;
      this.width = canvas.width;
      this.height = canvas.height;
      this.dino = {
        x: 48,
        y: 47, // groundY - 47
        w: 44,
        h: 47,
        vy: 0,
        isJumping: false,
        legFrame: 88, // 88 or 132
        frameCounter: 0
      };
      this.cacti = [];
      this.clouds = [
        { x: 80, y: 16, speed: 0.5 },
        { x: 260, y: 12, speed: 0.35 },
        { x: 440, y: 22, speed: 0.6 }
      ];
      this.groundDots = [];
      this.nextCactusTimer = 75;
      this.animationId = null;
      this.sprites = null;
      this.spritesLoaded = false;
      this.restartBounds = { x: 0, y: 0, w: 36, h: 32 };

      this.initGround();

      this.handleInput = (e) => {
        if (e) e.preventDefault();
        if (this.state === 'RUNNING') {
          this.jump();
        } else if (this.state === 'GAME_OVER') {
          // Check restart click or tap
          runZeroTouchExport();
        }
      };

      this.handleKey = (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          e.preventDefault();
          if (this.state === 'RUNNING') {
            this.jump();
          } else if (this.state === 'GAME_OVER') {
            runZeroTouchExport();
          }
        }
      };
    }

    async preloadSprites() {
      if (this.spritesLoaded) return;
      const [trex, text, restart, cactusSmall, cactusLarge] = await Promise.all([
        loadInvertedImage(DINO_SPRITES.trex),
        loadInvertedImage(DINO_SPRITES.text),
        loadInvertedImage(DINO_SPRITES.restart),
        loadInvertedImage(DINO_SPRITES.cactusSmall),
        loadInvertedImage(DINO_SPRITES.cactusLarge)
      ]);
      this.sprites = { trex, text, restart, cactusSmall, cactusLarge };
      this.spritesLoaded = true;
    }

    initGround() {
      this.groundDots = [];
      for (let i = 0; i < 22; i++) {
        this.groundDots.push({
          x: Math.random() * (this.width || 580),
          offsetY: (i % 2 === 0 ? 2 : 4),
          w: (i % 3 === 0 ? 6 : 3)
        });
      }
    }

    async start() {
      await this.preloadSprites();
      this.state = 'RUNNING';
      this.score = 0;
      this.speed = 4.2;
      this.cacti = [];
      this.nextCactusTimer = 55;
      this.groundY = 94;
      this.dino.y = this.groundY - 47;
      this.dino.vy = 0;
      this.dino.isJumping = false;
      this.dino.legFrame = 88;

      this.resize();
      this.canvas.removeEventListener('click', this.handleInput);
      window.removeEventListener('keydown', this.handleKey);
      this.canvas.addEventListener('click', this.handleInput);
      window.addEventListener('keydown', this.handleKey);

      if (this.animationId) cancelAnimationFrame(this.animationId);

      const loop = () => {
        if (this.state !== 'RUNNING') return;
        this.update();
        this.draw();
        this.animationId = requestAnimationFrame(loop);
      };
      this.animationId = requestAnimationFrame(loop);
    }

    stop(stateType) {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }

      if (stateType === 'ABORTED') {
        this.state = 'GAME_OVER';
        this.dino.isJumping = false;
        this.dino.y = this.groundY - 47;
        // Collided with cactus directly in front
        this.cacti = [{ x: this.dino.x + 44, type: 'small', w: 17, h: 35 }];
        this.drawGameOver();
      } else if (stateType === 'SUCCESS') {
        this.state = 'SUCCESS';
        this.dino.isJumping = false;
        this.dino.y = this.groundY - 47;
        this.drawSuccess();
        if (this.scoreEl) {
          this.scoreEl.innerText = `COMPLETED // ALL COURSES EXPORTED`;
        }
      } else {
        this.state = 'IDLE';
      }
    }

    jump() {
      if (!this.dino.isJumping && this.state === 'RUNNING') {
        this.dino.isJumping = true;
        this.dino.vy = -8.4;
      }
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(rect.width || 580);
      const h = Math.floor(rect.height || 100);
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      if (this.ctx.resetTransform) {
        this.ctx.resetTransform();
      } else {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      this.ctx.scale(dpr, dpr);
      this.width = w;
      this.height = h;
      this.groundY = h - 22;
      this.dino.y = Math.min(this.dino.y, this.groundY - 47);
    }

    update() {
      this.score += Math.round(this.speed * 0.35);
      const scoreStr = String(this.score).padStart(5, '0');
      if (this.scoreEl) {
        this.scoreEl.innerText = `DIST // ${scoreStr} M`;
      }

      // T-Rex Gravity & Jump
      if (this.dino.isJumping) {
        this.dino.y += this.dino.vy;
        this.dino.vy += 0.48;
        if (this.dino.y >= this.groundY - 47) {
          this.dino.y = this.groundY - 47;
          this.dino.vy = 0;
          this.dino.isJumping = false;
        }
      } else {
        this.dino.frameCounter++;
        if (this.dino.frameCounter % 6 === 0) {
          this.dino.legFrame = (this.dino.legFrame === 88 ? 132 : 88);
        }
      }

      // Autopilot AI Jump
      const nextCactus = this.cacti.find(c => c.x > this.dino.x);
      if (nextCactus) {
        const dist = nextCactus.x - (this.dino.x + 40);
        if (dist > 0 && dist < (this.speed * 11 + 6) && !this.dino.isJumping) {
          this.jump();
        }
      }

      // Spawn Cacti
      this.nextCactusTimer--;
      if (this.nextCactusTimer <= 0) {
        const isLarge = Math.random() > 0.65;
        this.cacti.push({
          x: this.width + 30,
          type: isLarge ? 'large' : 'small',
          w: isLarge ? 25 : 17,
          h: isLarge ? 50 : 35
        });
        this.nextCactusTimer = Math.floor(Math.random() * 60) + 75;
      }

      // Move Cacti
      for (let i = this.cacti.length - 1; i >= 0; i--) {
        this.cacti[i].x -= this.speed;
        if (this.cacti[i].x < -60) {
          this.cacti.splice(i, 1);
        }
      }

      // Move Clouds
      for (const cl of this.clouds) {
        cl.x -= cl.speed;
        if (cl.x < -60) cl.x = this.width + Math.random() * 40;
      }

      // Move Ground Dots
      for (const dot of this.groundDots) {
        dot.x -= this.speed;
        if (dot.x < -10) dot.x = this.width + Math.random() * 20;
      }
    }

    draw() {
      if (!this.spritesLoaded) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      for (const cl of this.clouds) {
        ctx.fillRect(cl.x, cl.y + 3, 26, 4);
        ctx.fillRect(cl.x + 6, cl.y, 14, 4);
        ctx.fillRect(cl.x + 3, cl.y + 1, 20, 4);
      }

      // Ground Line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, this.groundY);
      ctx.lineTo(this.width, this.groundY);
      ctx.stroke();

      // Ground Terrain Dashes
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      for (const dot of this.groundDots) {
        ctx.fillRect(dot.x, this.groundY + dot.offsetY, dot.w, 1);
      }

      // Cacti Obstacles
      for (const c of this.cacti) {
        if (c.type === 'large') {
          ctx.drawImage(this.sprites.cactusLarge, 0, 0, 25, 50, c.x, this.groundY - 50, 25, 50);
        } else {
          ctx.drawImage(this.sprites.cactusSmall, 0, 0, 17, 35, c.x, this.groundY - 35, 17, 35);
        }
      }

      // Official Chrome T-Rex Sprite
      const frameX = this.dino.isJumping ? 0 : this.dino.legFrame;
      ctx.drawImage(this.sprites.trex, frameX, 0, 44, 47, this.dino.x, this.dino.y, 44, 47);

      // In-Game Score (Top Right)
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.fillText(`HI ${this.highScore}  ${String(this.score).padStart(5, '0')}`, this.width - 16, 20);
    }

    // Exact Chrome Dino Game Over Screen (Identical to Native Chrome Screenshot)
    drawGameOver() {
      if (!this.spritesLoaded) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Ground Line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, this.groundY);
      ctx.lineTo(this.width, this.groundY);
      ctx.stroke();

      // Ground Dashes
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      for (let x = 12; x < this.width; x += 36) {
        ctx.fillRect(x, this.groundY + 2, 6, 1);
        ctx.fillRect(x + 14, this.groundY + 4, 3, 1);
      }

      // 1. Official Crashed T-Rex (Shocked wide-open eye, Frame 5 at x=220)
      ctx.drawImage(this.sprites.trex, 220, 0, 44, 47, this.dino.x, this.groundY - 47, 44, 47);

      // 2. Cactus Collided in Front
      ctx.drawImage(this.sprites.cactusSmall, 0, 0, 17, 35, this.dino.x + 44, this.groundY - 35, 17, 35);

      // Extra scenery cacti
      if (this.width > 480) {
        ctx.drawImage(this.sprites.cactusSmall, 0, 0, 34, 35, this.width - 180, this.groundY - 35, 34, 35);
      }
      ctx.drawImage(this.sprites.cactusLarge, 0, 0, 25, 50, this.width - 40, this.groundY - 50, 25, 50);

      // 3. Official GAME OVER Sprite Text (191 x 11)
      const textX = Math.round((this.width - 191) / 2);
      const textY = 22;
      ctx.drawImage(this.sprites.text, 0, 13, 191, 11, textX, textY, 191, 11);

      // 4. Official [ ⟳ ] Restart / Retry Button (36 x 32)
      const restartX = Math.round((this.width - 36) / 2);
      const restartY = 44;
      this.restartBounds = { x: restartX, y: restartY, w: 36, h: 32 };
      ctx.drawImage(this.sprites.restart, 0, 0, 36, 32, restartX, restartY, 36, 32);

      // 5. High Score and Aborted Distance
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.fillText(`HI ${this.highScore}  ${String(this.score).padStart(5, '0')}`, this.width - 16, 20);
    }

    // Success State Screen (When download completes 100%)
    drawSuccess() {
      if (!this.spritesLoaded) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Ground Line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, this.groundY);
      ctx.lineTo(this.width, this.groundY);
      ctx.stroke();

      // Ground Dashes
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      for (let x = 12; x < this.width; x += 36) {
        ctx.fillRect(x, this.groundY + 2, 6, 1);
        ctx.fillRect(x + 14, this.groundY + 4, 3, 1);
      }

      // 1. Standing T-Rex in Victory Pose (Frame 0 at x=0)
      ctx.drawImage(this.sprites.trex, 0, 0, 44, 47, this.dino.x, this.groundY - 47, 44, 47);

      // 2. Success Banner
      ctx.textAlign = 'center';
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('S U C C E S S // E X P O R T   C O M P L E T E', this.width / 2, 34);

      ctx.font = '600 10.5px ui-monospace, monospace';
      ctx.fillStyle = '#888888';
      ctx.fillText('ALL COURSE MATERIALS ARCHIVED (100%)', this.width / 2, 54);

      // 3. Top Right Score
      ctx.textAlign = 'right';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('HI 100%  DONE', this.width - 16, 20);
    }
  }

  // Create Floating Trigger Button
  function injectTriggerButton() {
    if (document.getElementById('umspec-trigger-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'umspec-trigger-btn';
    btn.innerHTML = `
      <span class="umspec-trigger-dot"></span>
      <span class="umspec-icon">${SPEC_STACK_ICON}</span>
      <span class="umspec-trigger-label">SMART EXPORT</span>
      <span class="umspec-badge">UMSPEC // OS</span>
    `;
    btn.title = 'UmSpec: Zero-Touch Smart Export for all SPeCTRUM courses';
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  // Abort Export Function
  function abortExport() {
    if (!isExporting) return;
    console.log('[UmSpec] Aborting export...');
    isExporting = false;

    // Restore course selection panel
    setSelectionPanelCollapsed(false);

    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    window.onbeforeunload = null;

    if (runnerInstance) {
      runnerInstance.stop('ABORTED');
    }

    const cancelBtn = document.getElementById('umspec-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    const startBtn = document.getElementById('umspec-start-btn');
    if (startBtn) {
      startBtn.disabled = false;
      updateSelectionUI();
    }

    const statusEl = document.getElementById('umspec-progress-status');
    if (statusEl) {
      statusEl.innerText = 'STATUS // EXPORT ABORTED BY USER';
      statusEl.style.color = 'var(--umspec-red, #d71921)';
    }

    const percentEl = document.getElementById('umspec-progress-percent');
    if (percentEl) percentEl.innerText = 'ABORTED';

    const fillEl = document.getElementById('umspec-progress-fill');
    if (fillEl) fillEl.style.background = 'var(--umspec-red, #d71921)';

    detectedCourses.forEach(c => {
      const b = document.getElementById(`umspec-status-${c.id}`);
      if (b && (b.innerText.startsWith('FETCHING') || b.innerText === 'SCANNING')) {
        b.innerText = 'READY';
        b.style.color = '';
      }
    });
  }

  // Selection Panel Accordion Collapse / Expand Helpers
  function setSelectionPanelCollapsed(collapsed) {
    const section = document.getElementById('umspec-selection-section');
    const header = document.getElementById('umspec-section-header');
    const tools = document.getElementById('umspec-selection-tools');
    const toggleBtn = document.getElementById('umspec-toggle-selection');
    const toggleText = document.getElementById('umspec-toggle-text');
    if (!section) return;

    if (collapsed) {
      section.classList.add('umspec-collapsed');
      if (header) header.classList.add('umspec-clickable-header');
      if (tools) tools.style.display = 'none';
      if (toggleBtn) toggleBtn.style.display = 'inline-flex';
      if (toggleText) toggleText.innerText = 'EXPAND';
    } else {
      section.classList.remove('umspec-collapsed');
      if (header) {
        if (isExporting) header.classList.add('umspec-clickable-header');
        else header.classList.remove('umspec-clickable-header');
      }
      if (tools) tools.style.display = isExporting ? 'none' : 'flex';
      if (toggleBtn) toggleBtn.style.display = isExporting ? 'inline-flex' : 'none';
      if (toggleText) toggleText.innerText = 'COLLAPSE';
    }
  }

  function toggleSelectionPanel() {
    const section = document.getElementById('umspec-selection-section');
    if (!section) return;
    const isCurrentlyCollapsed = section.classList.contains('umspec-collapsed');
    setSelectionPanelCollapsed(!isCurrentlyCollapsed);
  }

  // Create & Inject Modal DOM
  function createModalDOM() {
    if (document.getElementById('umspec-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'umspec-modal-overlay';
    overlay.innerHTML = `
      <div id="umspec-modal">
        <div class="umspec-modal-header">
          <div class="umspec-header-title">
            <span class="umspec-header-icon-box"><span class="umspec-icon">${SPEC_STACK_ICON}</span></span>
            <div>
              <div class="umspec-header-sub">UMSPEC // ENGINE 4.0</div>
              <h2>COURSE EXPORTER</h2>
            </div>
          </div>
          <div class="umspec-header-meta">
            <span class="umspec-live-pill"><span class="umspec-red-dot"></span> LIVE SPeCTRUM</span>
            <button class="umspec-close-btn" id="umspec-close-modal" title="Close" aria-label="Close exporter">${ICONS.close}</button>
          </div>
        </div>

        <div class="umspec-modal-body">
          <!-- Student Academic Profile Card -->
          <div class="umspec-profile-card" id="umspec-profile-card">
            <div class="umspec-profile-header">
              <span class="umspec-profile-badge">${ICONS.graduationCap} ACADEMIC PROGRAMME</span>
              <span class="umspec-profile-year" id="umspec-profile-year">DETECTING...</span>
            </div>
            <div class="umspec-profile-major" id="umspec-profile-major" contenteditable="true" spellcheck="false" role="textbox" aria-label="Academic Programme" title="Click to edit programme">DETECTING PROGRAMME...</div>
            <div class="umspec-profile-faculty" id="umspec-profile-faculty">UNIVERSITI MALAYA</div>
          </div>

          <!-- Course Overview Section -->
          <div class="umspec-selection-section" id="umspec-selection-section">
            <div class="umspec-section-label" id="umspec-section-header">
              <div class="umspec-section-title-wrap">
                <span>ENROLLED SUBJECTS // [<span id="umspec-selected-count">0</span>/<span id="umspec-course-count">0</span> SELECTED]</span>
              </div>
              <div class="umspec-selection-tools" id="umspec-selection-tools">
                <button type="button" class="umspec-link-btn" id="umspec-select-all">SELECT ALL</button>
                <span class="umspec-sep">//</span>
                <button type="button" class="umspec-link-btn" id="umspec-deselect-all">DESELECT</button>
              </div>
              <button type="button" class="umspec-toggle-btn" id="umspec-toggle-selection" style="display: none;" title="Toggle selection list">
                <span id="umspec-toggle-text">EXPAND</span>
                <span class="umspec-toggle-chevron">${ICONS.chevronDown}</span>
              </button>
            </div>

            <div class="umspec-courses-list" id="umspec-courses-container">
              <div style="padding: 24px; text-align: center; color: #64748b; display: flex; align-items: center; justify-content: center; gap: 8px;">
                ${ICONS.loader} <span>SCANNING SPeCTRUM SESSION & MATERIALS...</span>
              </div>
            </div>
          </div>

          <!-- Progress & Chrome Dino Runner Card -->
          <div class="umspec-progress-card" id="umspec-progress-card">
            <!-- Chrome Dino Runner Animation Box -->
            <div class="umspec-runner-box" id="umspec-runner-box">
              <div class="umspec-runner-header">
                <div class="umspec-runner-badge">
                  <span class="umspec-runner-pulse"></span>
                  <span>SYNC ENGINE // CHROME DINO RUNNER</span>
                </div>
                <div class="umspec-runner-telemetry">
                  <span class="umspec-runner-score" id="umspec-runner-score">DIST // 00000 M</span>
                </div>
              </div>
              <canvas id="umspec-runner-canvas" height="116"></canvas>
            </div>

            <div class="umspec-progress-header">
              <span id="umspec-progress-title">EXPORT TELEMETRY //</span>
              <div class="umspec-progress-header-right">
                <span id="umspec-progress-percent">0%</span>
              </div>
            </div>
            <div class="umspec-progress-bar-bg">
              <div class="umspec-progress-bar-fill" id="umspec-progress-fill"></div>
            </div>
            <div class="umspec-status-text" id="umspec-progress-status">PREPARING MATERIALS...</div>
          </div>
        </div>

        <div class="umspec-modal-footer">
          <div class="umspec-footer-info" id="umspec-footer-stats"></div>
          <div class="umspec-footer-actions">
            <button class="umspec-btn-cancel" id="umspec-cancel-btn" type="button" style="display: none;">
              ${ICONS.close} <span>ABORT DOWNLOAD</span>
            </button>
            <button class="umspec-btn-primary" id="umspec-start-btn" type="button">
              ${ICONS.download} <span>EXPORT</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('umspec-close-modal').onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };

    document.getElementById('umspec-cancel-btn').onclick = abortExport;

    document.getElementById('umspec-select-all').onclick = () => {
      if (isExporting) return;
      selectedCourseIds = new Set(detectedCourses.map(c => c.id));
      renderCoursesList();
    };

    document.getElementById('umspec-deselect-all').onclick = () => {
      if (isExporting) return;
      selectedCourseIds.clear();
      renderCoursesList();
    };

    const toggleBtn = document.getElementById('umspec-toggle-selection');
    if (toggleBtn) {
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleSelectionPanel();
      };
    }

    const sectionHeader = document.getElementById('umspec-section-header');
    if (sectionHeader) {
      sectionHeader.onclick = (e) => {
        if (e.target.closest('#umspec-selection-tools')) return;
        if (isExporting || document.getElementById('umspec-selection-section')?.classList.contains('umspec-collapsed')) {
          toggleSelectionPanel();
        }
      };
    }

    document.getElementById('umspec-start-btn').onclick = runZeroTouchExport;

    // Academic Programme Inline Editor Listeners (No frame, text cursor only)
    const majorEl = document.getElementById('umspec-profile-major');
    if (majorEl) {
      const saveDegree = () => {
        const val = majorEl.innerText.trim();
        if (val && val !== 'DETECTING PROGRAMME...') {
          if (studentProfile) {
            studentProfile.bachelor = val;
          }
          localStorage.setItem('umspec_saved_degree', val);
        }
      };
      majorEl.addEventListener('blur', saveDegree);
      majorEl.addEventListener('input', saveDegree);
      majorEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          majorEl.blur();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const ov = document.getElementById('umspec-modal-overlay');
        if (ov && ov.classList.contains('umspec-active')) {
          closeModal();
        }
      }
    });
  }

  // Open & Populate Modal
  async function openModal() {
    createModalDOM();
    const overlay = document.getElementById('umspec-modal-overlay');
    overlay.classList.add('umspec-active');

    if (!isExporting) {
      setSelectionPanelCollapsed(false);
    }

    if (detectedCourses.length === 0) {
      detectedCourses = await discoverCourses();
      selectedCourseIds = new Set(detectedCourses.map(c => c.id));
      updateProfileUI();
      renderCoursesList();
    }
  }

  function closeModal() {
    if (isExporting) {
      if (confirm('Export is currently running. Abort download?')) {
        abortExport();
      } else {
        return;
      }
    }
    const overlay = document.getElementById('umspec-modal-overlay');
    if (overlay) overlay.classList.remove('umspec-active');
  }

  // Update Profile UI
  function updateProfileUI() {
    if (!studentProfile) return;
    document.getElementById('umspec-profile-year').innerText = studentProfile.yearSem;
    const majorEl = document.getElementById('umspec-profile-major');
    if (majorEl && document.activeElement !== majorEl) {
      majorEl.innerText = studentProfile.bachelor;
    }
    document.getElementById('umspec-profile-faculty').innerText = studentProfile.faculty;
  }

  // Update Selection UI & Button Text
  function updateSelectionUI() {
    const selectedCountEl = document.getElementById('umspec-selected-count');
    const totalCountEl = document.getElementById('umspec-course-count');
    const startBtn = document.getElementById('umspec-start-btn');
    if (!startBtn) return;

    const count = selectedCourseIds.size;
    const total = detectedCourses.length;

    if (selectedCountEl) selectedCountEl.innerText = count;
    if (totalCountEl) totalCountEl.innerText = total;

    startBtn.disabled = count === 0;
    startBtn.innerHTML = `${ICONS.download} <span>EXPORT</span>`;
  }

  // Render Courses List (Pristine Custom Nothing Checkbox)
  function renderCoursesList() {
    const container = document.getElementById('umspec-courses-container');
    const countEl = document.getElementById('umspec-course-count');
    if (!container) return;

    if (detectedCourses.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--umspec-red, #d71921); font-family: var(--umspec-font-mono); font-size: 11px; letter-spacing: 0.08em; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${ICONS.alertCircle} <span>NO ENROLLED COURSES FOUND // VERIFY SPeCTRUM LOGIN</span>
        </div>
      `;
      if (countEl) countEl.innerText = '0';
      updateSelectionUI();
      return;
    }

    container.innerHTML = detectedCourses.map(c => {
      const isSelected = selectedCourseIds.has(c.id);
      return `
        <div class="umspec-course-row ${isSelected ? '' : 'umspec-row-unselected'}" id="umspec-row-${c.id}" data-id="${c.id}">
          <div class="umspec-course-info">
            <label class="umspec-checkbox-label" for="umspec-chk-${c.id}" title="Toggle course selection">
              <input type="checkbox" id="umspec-chk-${c.id}" class="umspec-course-checkbox" data-id="${c.id}" ${isSelected ? 'checked' : ''} />
              <span class="umspec-custom-checkbox" aria-hidden="true">
                <svg class="umspec-check-glyph" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
              </span>
            </label>
            <div class="umspec-course-text-wrap">
              <div class="umspec-course-title" id="umspec-title-${c.id}">${c.fullName}</div>
            </div>
          </div>
          <span class="umspec-course-status" id="umspec-status-${c.id}">READY</span>
        </div>
      `;
    }).join('');

    // Attach row toggle handlers
    container.querySelectorAll('.umspec-course-row').forEach(row => {
      const id = parseInt(row.getAttribute('data-id'));
      const chk = row.querySelector('.umspec-course-checkbox');

      const toggleRow = (select) => {
        if (isExporting) return;
        if (select) {
          selectedCourseIds.add(id);
          row.classList.remove('umspec-row-unselected');
          if (chk) chk.checked = true;
        } else {
          selectedCourseIds.delete(id);
          row.classList.add('umspec-row-unselected');
          if (chk) chk.checked = false;
        }
        updateSelectionUI();
      };

      if (chk) {
        chk.addEventListener('change', (e) => {
          toggleRow(e.target.checked);
        });
      }

      row.addEventListener('click', (e) => {
        if (e.target.closest('.umspec-checkbox-label')) return;
        toggleRow(!selectedCourseIds.has(id));
      });
    });

    updateSelectionUI();
  }

  // Helper: Fetch binary data with abort signal
  async function fetchBinary(url, defaultName, signal) {
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const realLink = doc.querySelector('.resourceworkaround a, .resourcecontent object, a[href*="pluginfile.php"]');
      if (realLink) {
        const nextUrl = realLink.getAttribute('data') || realLink.getAttribute('href');
        if (nextUrl && nextUrl.includes('pluginfile.php')) {
          return fetchBinary(nextUrl, defaultName, signal);
        }
      }
      return null;
    }

    let filename = defaultName;
    const cd = res.headers.get('Content-Disposition') || '';
    const mUtf = cd.match(/filename\*=UTF-8''([^;\r\n]+)/i);
    const mStd = cd.match(/filename="([^"]+)"/i);
    const mUnq = cd.match(/filename=([^;\s]+)/i);

    if (mUtf) filename = decodeURIComponent(mUtf[1]);
    else if (mStd) filename = mStd[1];
    else if (mUnq) filename = mUnq[1].replace(/['"]/g, '');
    else {
      const base = new URL(res.url).pathname.split('/').pop();
      if (base && base.includes('.') && !base.includes('.php')) {
        filename = decodeURIComponent(base);
      }
    }

    const data = await res.arrayBuffer();
    return { filename: sanitizeName(filename), data };
  }

  // Zero-Touch Smart Export Pipeline with Live Dino Runner & Abort Handling
  async function runZeroTouchExport() {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library is missing. Please refresh the page.');
      return;
    }

    if (detectedCourses.length === 0) {
      alert('No enrolled courses detected.');
      return;
    }

    const coursesToExport = detectedCourses.filter(c => selectedCourseIds.has(c.id));
    if (coursesToExport.length === 0) {
      alert('Please select at least one course to export.');
      return;
    }

    isExporting = true;
    abortController = new AbortController();
    window.onbeforeunload = () => 'Export in progress. Exiting will abort download.';

    // Collapse the selection panel immediately to focus on Dino runner & progress telemetry
    setSelectionPanelCollapsed(true);

    const startBtn = document.getElementById('umspec-start-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = `${ICONS.loader} <span>DOWNLOADING ARCHIVE...</span>`;

    const cancelBtn = document.getElementById('umspec-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    const progressCard = document.getElementById('umspec-progress-card');
    progressCard.style.display = 'block';

    const fillEl = document.getElementById('umspec-progress-fill');
    const percentEl = document.getElementById('umspec-progress-percent');
    const statusEl = document.getElementById('umspec-progress-status');
    const footerStats = document.getElementById('umspec-footer-stats');

    // Start Chrome Dino Runner Animation
    const canvasEl = document.getElementById('umspec-runner-canvas');
    const scoreEl = document.getElementById('umspec-runner-score');
    if (canvasEl) {
      if (!runnerInstance) {
        runnerInstance = new UmSpecDragonRunner(canvasEl, scoreEl);
      }
      runnerInstance.start();
    }

    fillEl.style.background = '#ffffff';
    statusEl.style.color = '';

    const zip = new JSZip();
    let totalFiles = 0;
    let totalBytes = 0;
    const auditRows = [];
    const discoveredCategories = new Set();

    try {
      for (let i = 0; i < coursesToExport.length; i++) {
        if (!isExporting) break;

        const course = coursesToExport[i];
        const statusBadge = document.getElementById(`umspec-status-${course.id}`);
        if (statusBadge) {
          statusBadge.innerText = 'SCANNING';
          statusBadge.style.color = '#ffffff';
        }

        statusEl.innerText = `Analyzing course ${i + 1}/${coursesToExport.length}: ${course.fullName}...`;

        const cRes = await fetch(`https://spectrum.um.edu.my/course/view.php?id=${course.id}`, {
          credentials: 'include',
          signal: abortController.signal
        });
        const cHtml = await cRes.text();
        const cDoc = new DOMParser().parseFromString(cHtml, 'text/html');

        const itemsToDownload = [];
        const seenUrls = new Set();
        const externalLinks = [];

        const sections = cDoc.querySelectorAll('.course-content ul.topics > li, .course-content ul.weeks > li, .course-content .section');
        sections.forEach(sec => {
          const secTitleEl = sec.querySelector('.sectionname, .section-title, h3');
          const secName = secTitleEl ? secTitleEl.innerText.trim() : 'General';

          sec.querySelectorAll('.activity').forEach(act => {
            const modClasses = Array.from(act.classList).filter(c => c.startsWith('modtype_'));
            const modType = modClasses.length ? modClasses[0].replace('modtype_', '') : '';
            if (['attendance', 'forum', 'feedback', 'choice'].includes(modType)) return;

            const inst = act.querySelector('.instancename');
            let actName = inst ? inst.innerText.trim() : 'Material';
            ['File', 'URL', 'Assignment', 'Folder', 'Page', 'External tool'].forEach(sfx => {
              if (actName.endsWith(sfx)) actName = actName.slice(0, -sfx.length).trim();
            });

            const link = act.querySelector('a');
            if (!link || !link.href) return;
            const actUrl = link.href;
            if (seenUrls.has(actUrl)) return;
            seenUrls.add(actUrl);

            const extMatch = actUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            const ext = extMatch ? `.${extMatch[1]}` : '';
            const cat = classifyAdaptiveCategory(actName, secName, ext);
            discoveredCategories.add(cat.label);

            itemsToDownload.push({ name: actName, url: actUrl, type: modType, category: cat.id, section: secName });
          });

          sec.querySelectorAll('a[href*="youtu.be"], a[href*="youtube.com"], a[href*="drive.google.com"]').forEach(ea => {
            externalLinks.push({ title: ea.innerText.trim() || 'External Lecture Link', url: ea.href, section: secName });
          });
        });

        if (statusBadge) {
          statusBadge.innerText = `FETCHING (${itemsToDownload.length})`;
          statusBadge.style.color = '#ffffff';
        }

        let courseDownloadedCount = 0;

        for (let j = 0; j < itemsToDownload.length; j++) {
          if (!isExporting) break;

          const item = itemsToDownload[j];
          statusEl.innerText = `[${course.folderName}] (${j + 1}/${itemsToDownload.length}) ${item.name}`;

          const progressVal = Math.round(((i + (j / Math.max(1, itemsToDownload.length))) / coursesToExport.length) * 100);
          fillEl.style.width = `${progressVal}%`;
          percentEl.innerText = `${progressVal}%`;

          // Accelerate runner speed as download progresses
          if (runnerInstance && runnerInstance.state === 'RUNNING') {
            runnerInstance.speed = 4.2 + (progressVal / 100) * 2.8;
          }

          try {
            if (item.type === 'folder') {
              const fRes = await fetch(item.url, { credentials: 'include', signal: abortController.signal });
              const fHtml = await fRes.text();
              const fDoc = new DOMParser().parseFromString(fHtml, 'text/html');
              const fLinks = fDoc.querySelectorAll('a[href*="pluginfile.php"]');
              for (const fl of fLinks) {
                if (!isExporting) break;
                const fData = await fetchBinary(fl.href, fl.innerText.trim() || item.name, abortController.signal);
                if (fData) {
                  zip.file(`${course.folderName}/${item.category}/${fData.filename}`, fData.data);
                  totalFiles++;
                  totalBytes += fData.data.byteLength;
                  courseDownloadedCount++;
                }
              }
            } else if (item.type === 'assign') {
              const aRes = await fetch(item.url, { credentials: 'include', signal: abortController.signal });
              const aHtml = await aRes.text();
              const aDoc = new DOMParser().parseFromString(aHtml, 'text/html');
              const aLinks = aDoc.querySelectorAll('#intro a[href*="pluginfile.php"], .intro a[href*="pluginfile.php"], .fileuploadsubmission a[href*="pluginfile.php"]');
              for (const al of aLinks) {
                if (!isExporting) break;
                const aData = await fetchBinary(al.href, al.innerText.trim() || item.name, abortController.signal);
                if (aData) {
                  zip.file(`${course.folderName}/${item.category}/${aData.filename}`, aData.data);
                  totalFiles++;
                  totalBytes += aData.data.byteLength;
                  courseDownloadedCount++;
                }
              }
            } else {
              const fData = await fetchBinary(item.url, item.name, abortController.signal);
              if (fData) {
                zip.file(`${course.folderName}/${item.category}/${fData.filename}`, fData.data);
                totalFiles++;
                totalBytes += fData.data.byteLength;
                courseDownloadedCount++;
              }
            }
          } catch (e) {
            if (e.name === 'AbortError' || !isExporting) break;
            console.warn(`[UmSpec] Failed item ${item.name}:`, e);
          }
        }

        if (!isExporting) break;

        // Save external links markdown if present
        if (externalLinks.length > 0) {
          let linksMd = `# ${course.fullName} - Lecture & Video Links\n\n`;
          let curSec = null;
          externalLinks.forEach(el => {
            if (el.section !== curSec) {
              curSec = el.section;
              linksMd += `\n### ${curSec}\n\n`;
            }
            linksMd += `- [${el.title}](${el.url})\n`;
          });
          zip.file(`${course.folderName}/1.Lecture Slide/Lecture_Videos_and_Links.md`, linksMd);
          courseDownloadedCount++;
          totalFiles++;
        }

        const courseStatus = courseDownloadedCount > 0 ? 'Active' : 'Empty on SPeCTRUM';
        if (statusBadge) {
          statusBadge.innerText = courseDownloadedCount > 0 ? `READY (${courseDownloadedCount})` : 'EMPTY';
          statusBadge.style.color = courseDownloadedCount > 0 ? '#ffffff' : '#777777';
        }

        auditRows.push(`| **${course.folderName}** | ${course.fullName} | ${courseDownloadedCount} files | ${courseStatus} |`);
      }

      if (!isExporting) {
        console.log('[UmSpec] Download cancelled before compression');
        return;
      }

      // Record any unselected/excluded courses in audit table
      detectedCourses.filter(c => !selectedCourseIds.has(c.id)).forEach(c => {
        auditRows.push(`| **${c.folderName}** | ${c.fullName} | 0 files | Excluded by User |`);
      });

      // Generate Executive Academic Audit Report
      const auditReport = `# Universiti Malaya - SPeCTRUM Semester Academic Audit

> **Auto-Generated by UmSpec Zero-Touch Engine** on ${new Date().toLocaleString()}

---

## Student Academic Profile

* **Student:** ${studentProfile?.studentName || 'UM Student'}
* **Faculty:** ${studentProfile?.faculty || 'Faculty of Computer Science & Information Technology'}
* **Detected Programme:** ${studentProfile?.bachelor || 'Bachelor of Computer Science'}
* **Academic Period:** ${studentProfile?.yearSem || 'Year 2, Semester 1'}
* **Total Enrolled Courses:** ${detectedCourses.length} Courses (${coursesToExport.length} Exported)

---

## Course Content & Material Health Check

| Course Folder | Official Title | Materials Downloaded | Health Status |
| :--- | :--- | :---: | :--- |
${auditRows.join('\n')}

---

## Discovered Material Taxonomy

The following categories were dynamically identified and organized across your courses:
${Array.from(discoveredCategories).map(c => `* **${c}**`).join('\n')}

---

## Total Archive Statistics
* **Total Files:** ${totalFiles}
* **Total Uncompressed Size:** ${(totalBytes / (1024 * 1024)).toFixed(2)} MB

*Preserve this audit report as your official semester archive index.*
`;

      zip.file('SEMESTER_AUDIT_REPORT.md', auditReport);

      // Compress and Save ZIP
      statusEl.innerText = 'Compressing into ZIP archive...';
      fillEl.style.width = '100%';
      percentEl.innerText = '100%';

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
        (meta) => {
          if (!isExporting) return;
          percentEl.innerText = `${Math.round(meta.percent)}%`;
          fillEl.style.width = `${meta.percent}%`;
          statusEl.innerText = `Compressing: ${Math.round(meta.percent)}% done...`;
        }
      );

      if (!isExporting) return;

      const downloadUrl = URL.createObjectURL(zipBlob);
      const downloadLink = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadLink.href = downloadUrl;
      downloadLink.download = `SPeCTRUM_Smart_Export_${dateStr}.zip`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

      statusEl.innerText = `COMPLETED // Processed ${totalFiles} files (${(totalBytes / (1024 * 1024)).toFixed(1)} MB).`;
      footerStats.innerText = `SAVED // SPeCTRUM_Smart_Export_${dateStr}.zip`;
      startBtn.innerHTML = `${ICONS.checkCircle} <span>EXPORT COMPLETE</span>`;

      if (runnerInstance) {
        runnerInstance.stop('SUCCESS');
      }

    } catch (err) {
      if (err.name === 'AbortError' || !isExporting) {
        console.log('[UmSpec] Export was aborted by user');
        return;
      }
      console.error('[UmSpec] Smart export error:', err);
      statusEl.innerText = `ERROR // ${err.message}`;
      alert(`Smart export failed: ${err.message}`);
    } finally {
      isExporting = false;
      window.onbeforeunload = null;
      if (cancelBtn) cancelBtn.style.display = 'none';
      startBtn.disabled = false;
    }
  }

  // Inject UI on SPeCTRUM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTriggerButton);
  } else {
    injectTriggerButton();
  }

})();
