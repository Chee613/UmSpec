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
  let exportRunId = 0;
  let abortController = null;
  let runnerInstance = null;
  let sesskey = null;
  let videoDownloadPreference = localStorage.getItem('umspec_video_pref') || 'skip';
  let cachedCourseAnalysis = null;
  let destinationMode = 'zip';
  let coursePage = 0;
  let materialPage = 0;

  // Granular Course Materials & Right Flyout Drawer State
  let courseItemsCache = new Map(); // courseId -> array of item objects
  let courseItemsSelected = new Map(); // courseId -> Set of selected item URLs
  let inspectingCourseId = null; // currently open course in Right Drawer (null if closed)
  let rightDrawerFilter = 'all'; // 'all', 'doc', 'video', 'external'
  let leftDrawerFilter = rightDrawerFilter;

  // Video Auto-Calculation & Telemetry State
  let isProbingVideos = false;

  // Preconfigured Backend Proxy Endpoint (Handles keys & model cascades on server)
  const DEFAULT_BACKEND_URL = 'https://umspec-ai.tankeat0613.workers.dev';
  let savedBackend = localStorage.getItem('umspec_backend_url');
  let backendEndpointUrl = (savedBackend && !savedBackend.includes('localhost:3000')) ? savedBackend : DEFAULT_BACKEND_URL;
  let geminiApiKeyPool = (localStorage.getItem('umspec_gemini_keys') || '').split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
  let geminiPrimaryModel = localStorage.getItem('umspec_gemini_primary_model') || 'gemini-3.5-flash-lite';
  let geminiFallbackModel = localStorage.getItem('umspec_gemini_fallback_model') || 'gemini-3.1-flash-lite';
  let geminiCustomPrimary = localStorage.getItem('umspec_gemini_custom_primary') || '';
  let geminiCustomFallback = localStorage.getItem('umspec_gemini_custom_fallback') || '';
  let geminiEnabled = localStorage.getItem('umspec_gemini_enabled') === 'true' && localStorage.getItem('umspec_ai_disclosure') === '1';
  let currentKeyIndex = 0;

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
    video: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`,
    sparkles: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2L9.5 8.5L3 11L9.5 13.5L12 20L14.5 13.5L21 11L14.5 8.5L12 2Z"/></svg>`,
    fileText: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
    chevronDown: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`,
    chevronRight: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>`,
    settings: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
    lock: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`,
    link: `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`
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

  // Helper: Format bytes into human-readable string
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = (bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0);
    return `${val} ${units[i]}`;
  }

  // Helper: Format seconds into human-readable estimated time
  function formatEstimatedTime(seconds) {
    if (!seconds || seconds <= 0) return '< 10s';
    if (seconds < 60) return `~${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const remSec = Math.round(seconds % 60);
    return remSec > 5 ? `~${mins}m ${remSec}s` : `~${mins} min`;
  }

  // Helper: Escape HTML strings for secure DOM interpolation
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Helper: Escape attribute strings
  function escapeAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Helper: Convert ArrayBuffer to Base64
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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
    if (['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.webm', '.flv', '.m4v'].includes(e) || text.includes('recording') || text.includes('video') || text.includes('webinar') || text.includes('panopto') || text.includes('zoom meeting')) {
      return { id: '7.Recordings & Media', label: 'Media & Videos' };
    }
    return { id: '1.Lecture Slide', label: 'General Course Materials' };
  }

  const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.webm', '.flv', '.m4v', '.wav', '.ogg'];
  const EXTERNAL_VIDEO_DOMAINS = [
    'panopto.com',
    'panopto.eu',
    'zoom.us',
    'teams.microsoft.com',
    'microsoftstream.com',
    'webex.com',
    'youtube.com',
    'youtu.be',
    'drive.google.com',
    'vimeo.com',
    'echo360',
    'loom.com'
  ];

  function isExternalVideoUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return EXTERNAL_VIDEO_DOMAINS.some(domain => lower.includes(domain));
  }

  function isVideoActivity(actName, actUrl, modType, categoryId) {
    if (globalThis.UmSpecSync.isVideoMaterial({ name: actName, url: actUrl, type: modType, category: categoryId })) return true;
    const text = `${actName}`.toLowerCase();
    const extMatch = (actUrl || '').match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

    if (VIDEO_EXTENSIONS.includes(ext)) return true;
    if (categoryId === '7.Recordings & Media') return true;
    if (['kalvidres', 'panopto'].includes(modType)) return true;
    if (text.includes('recording') || text.includes('lecture video') || text.includes('webinar') || text.includes('zoom meeting') || text.includes('panopto')) return true;

    return false;
  }

  // Get SPeCTRUM sesskey
  function getSesskey() {
    if (sesskey) return sesskey;
    if (typeof window !== 'undefined' && window.M?.cfg?.sesskey) {
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
    for (const s of document.scripts || []) {
      const text = s.textContent || '';
      const m = text.match(/"sesskey"\s*:\s*"([a-zA-Z0-9]+)"/);
      if (m) {
        sesskey = m[1];
        return sesskey;
      }
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
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('Dino sprite loading timed out.')), 5000);
      img.onerror = () => { clearTimeout(timer); reject(new Error('Dino sprite could not load.')); };
      img.onload = () => {
        try {
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
        } catch (error) { reject(error); }
        finally { clearTimeout(timer); }
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
        if (!this.canvas.getClientRects().length || !document.getElementById('umspec-modal-overlay')?.classList.contains('umspec-active')) return;
        if (e) e.preventDefault();
        this.canvas.focus({ preventScroll: true });
        if (this.state === 'RUNNING') {
          this.jump();
        } else if (this.state === 'GAME_OVER') {
          // Check restart click or tap
          runZeroTouchExport();
        }
      };

      this.handleKey = (e) => {
        if (e.target !== this.canvas || !this.canvas.getClientRects().length || !document.getElementById('umspec-modal-overlay')?.classList.contains('umspec-active') || !['RUNNING', 'GAME_OVER'].includes(this.state)) return;
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          e.preventDefault();
          if (this.state === 'RUNNING') {
            this.jump();
          } else if (this.state === 'GAME_OVER') {
            runZeroTouchExport();
          }
        }
      };
      this.canvas.addEventListener('click', this.handleInput);
      this.canvas.addEventListener('keydown', this.handleKey);
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
      const token = this.startToken = {};
      await this.preloadSprites();
      if (this.startToken !== token) {
        this.resize();
        if (this.state === 'SUCCESS') this.drawSuccess();
        else if (this.state === 'GAME_OVER') this.drawGameOver();
        return;
      }
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
      this.startToken = null;
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
    exportRunId++;

    // Restore course selection panel
    setSelectionPanelCollapsed(false);

    const advCard = document.getElementById('umspec-video-advisory-card');
    if (advCard) advCard.style.display = 'none';

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
    const backBtn = document.getElementById('umspec-export-back');
    if (backBtn) backBtn.disabled = false;

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
    if (isCurrentlyCollapsed) renderCoursesList();
  }

  function showModalTab(tab) {
    closeCourseInspector();
    document.querySelectorAll('[data-umspec-tab]').forEach(button => {
      const active = button.dataset.umspecTab === tab;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-umspec-view]').forEach(view => { view.hidden = view.dataset.umspecView !== tab; });
    const footer = document.querySelector('#umspec-modal .umspec-modal-footer');
    if (footer) footer.hidden = tab !== 'courses';
  }

  function addPageControls(container, total, page, size, change) {
    if (total <= size) return;
    const pager = document.createElement('nav'); pager.className = 'umspec-pager'; pager.setAttribute('aria-label', 'List pages');
    const previous = document.createElement('button'), next = document.createElement('button'), label = document.createElement('span');
    previous.type = next.type = 'button'; previous.textContent = 'Previous'; next.textContent = 'Next';
    previous.disabled = page === 0; next.disabled = (page + 1) * size >= total;
    label.textContent = (page + 1) + ' / ' + Math.ceil(total / size);
    previous.onclick = () => change(page - 1); next.onclick = () => change(page + 1);
    pager.append(previous, label, next); container.append(pager);
  }

  // Create & Inject Modal DOM
  function createModalDOM() {
    if (document.getElementById('umspec-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'umspec-modal-overlay';
    overlay.innerHTML = `
      <!-- Main Course Exporter Window -->
      <div id="umspec-modal">
        <div class="umspec-modal-header">
          <div class="umspec-header-title">
            <span class="umspec-header-icon-box"><span class="umspec-icon">${SPEC_STACK_ICON}</span></span>
            <div>
              <div class="umspec-header-sub">Universiti Malaya</div>
              <h2>UM Spec</h2>
            </div>
          </div>
          <div class="umspec-header-meta">
            <span class="umspec-live-pill"><span class="umspec-red-dot"></span> Spectrum</span>
            <button class="umspec-close-btn" id="umspec-close-modal" title="Close" aria-label="Close exporter">${ICONS.close}</button>
          </div>
        </div>

        <nav class="umspec-tabs" role="tablist" aria-label="UM Spec">
          <button type="button" role="tab" id="umspec-tab-courses" aria-controls="umspec-view-courses" aria-selected="true" data-umspec-tab="courses">${ICONS.bookOpen}<span>Courses</span></button>
          <button type="button" role="tab" id="umspec-tab-dates" aria-controls="umspec-view-dates" aria-selected="false" tabindex="-1" data-umspec-tab="dates">${ICONS.checkCircle}<span>Dates</span></button>
          <button type="button" role="tab" id="umspec-tab-settings" aria-controls="umspec-view-settings" aria-selected="false" tabindex="-1" data-umspec-tab="settings">${ICONS.settings}<span>Settings</span></button>
        </nav>
        <div class="umspec-modal-body">
          <section id="umspec-view-courses" data-umspec-view="courses" role="tabpanel" aria-labelledby="umspec-tab-courses">
          <div id="umspec-sync-home-host"></div>
          <!-- Course Overview Section -->
          <div class="umspec-selection-section" id="umspec-selection-section">
            <div class="umspec-section-label" id="umspec-section-header">
              <div class="umspec-section-title-wrap">
                <span>Choose courses · <span id="umspec-selected-count">0</span> of <span id="umspec-course-count">0</span></span>
              </div>
              <div class="umspec-selection-tools" id="umspec-selection-tools">
                <button type="button" class="umspec-link-btn" id="umspec-select-all">Select all</button>
                <span class="umspec-sep">//</span>
                <button type="button" class="umspec-link-btn" id="umspec-deselect-all">Clear</button>
              </div>
              <button type="button" class="umspec-toggle-btn" id="umspec-toggle-selection" style="display: none;" title="Toggle selection list">
                <span id="umspec-toggle-text">EXPAND</span>
                <span class="umspec-toggle-chevron">${ICONS.chevronDown}</span>
              </button>
            </div>

            <div class="umspec-courses-list" id="umspec-courses-container">
              <div style="padding: 24px; text-align: center; color: #64748b; display: flex; align-items: center; justify-content: center; gap: 8px;">
                ${ICONS.loader} <span>Finding your courses…</span>
              </div>
            </div>
          </div>

          <!-- Pre-Export Video Advisory Modal Card -->
          <div class="umspec-video-advisory-card" id="umspec-video-advisory-card">
            <div class="umspec-advisory-header">
              <span class="umspec-advisory-badge">
                <span class="umspec-pulse-dot-red"></span>
                <span>MEDIA ADVISORY // LARGE VIDEOS DETECTED</span>
              </span>
              <span class="umspec-advisory-time-tag" id="umspec-advisory-time">EST. ~3 MIN</span>
            </div>
            <div class="umspec-advisory-body">
              <div class="umspec-advisory-headline">
                <span id="umspec-advisory-count">3 Video Recordings</span> totaling <span id="umspec-advisory-size" style="color: #ffffff; font-weight: 700;">840 MB</span> detected.
              </div>
              <p class="umspec-advisory-desc">
                Downloading heavy video files in browser memory may take several minutes and cause tab lag. Would you like to export slides/assignments with video links indexed in Markdown, or proceed with full video files?
              </p>
              <div class="umspec-advisory-bento">
                <div class="umspec-advisory-metric">
                  <span class="umspec-metric-label">DETECTED VIDEOS</span>
                  <span class="umspec-metric-val" id="umspec-metric-videos">3</span>
                </div>
                <div class="umspec-advisory-metric">
                  <span class="umspec-metric-label">TOTAL VIDEO SIZE</span>
                  <span class="umspec-metric-val" id="umspec-metric-size">840 MB</span>
                </div>
                <div class="umspec-advisory-metric">
                  <span class="umspec-metric-label">ESTIMATED TIME</span>
                  <span class="umspec-metric-val" id="umspec-metric-time">~2m 48s</span>
                </div>
              </div>
              <div class="umspec-advisory-actions">
                <button type="button" class="umspec-btn-advisory-skip" id="umspec-btn-advisory-skip">
                  ${ICONS.bolt} <span>SKIP VIDEOS &amp; EXPORT (RECOMMENDED - FAST)</span>
                </button>
                <button type="button" class="umspec-btn-advisory-download" id="umspec-btn-advisory-include">
                  ${ICONS.download} <span>DOWNLOAD FULL VIDEOS ANYWAY</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Progress & Chrome Dino Runner Card -->
          <div class="umspec-progress-card" id="umspec-progress-card">
            <div class="umspec-runner-box" id="umspec-runner-box">
              <div class="umspec-runner-header">
                <div class="umspec-runner-badge"><span class="umspec-runner-pulse"></span><span>Chrome Dino Runner</span></div>
                <span class="umspec-runner-score" id="umspec-runner-score">DIST // 00000 M</span>
              </div>
              <canvas id="umspec-runner-canvas" height="116" tabindex="0" aria-label="Dino runner" aria-describedby="umspec-runner-tip">Dino runner export progress</canvas>
              <div class="umspec-runner-actions"><span id="umspec-runner-tip">Click or tap, or focus the game and press Space / ↑.</span><button type="button" id="umspec-export-back">Back to courses</button></div>
            </div>
            <div class="umspec-progress-header">
              <span id="umspec-progress-title">Download progress</span>
              <div class="umspec-progress-header-right">
                <span id="umspec-progress-percent">0%</span>
              </div>
            </div>
            <div class="umspec-progress-bar-bg">
              <div class="umspec-progress-bar-fill" id="umspec-progress-fill"></div>
            </div>
            <div class="umspec-status-text" id="umspec-progress-status">PREPARING MATERIALS...</div>
          </div>
          </section>
          <section id="umspec-view-dates" data-umspec-view="dates" role="tabpanel" aria-labelledby="umspec-tab-dates" hidden><div id="umspec-dates-host"></div></section>
          <section id="umspec-view-settings" data-umspec-view="settings" role="tabpanel" aria-labelledby="umspec-tab-settings" hidden>
            <div id="umspec-settings-host"></div>
            <div id="umspec-extra-settings">          <!-- Student Academic Profile Card -->
          <div class="umspec-profile-card" id="umspec-profile-card">
            <div class="umspec-profile-header">
              <span class="umspec-profile-badge">${ICONS.graduationCap} ACADEMIC PROGRAMME</span>
              <span class="umspec-profile-year" id="umspec-profile-year">DETECTING...</span>
            </div>
            <div class="umspec-profile-major" id="umspec-profile-major" contenteditable="true" spellcheck="false" role="textbox" aria-label="Academic Programme" title="Click to edit programme">DETECTING PROGRAMME...</div>
            <div class="umspec-profile-faculty" id="umspec-profile-faculty">UNIVERSITI MALAYA</div>
          </div>

          <!-- Streamlined Nothing OS AI Proforma Card -->
          <div class="umspec-ai-card" id="umspec-ai-card">
            <div class="umspec-ai-card-left">
              <div class="umspec-ai-sparkle-box">${ICONS.sparkles}</div>
              <div>
                <div class="umspec-ai-card-title">AI syllabus analysis</div>
                <div class="umspec-ai-card-sub" id="umspec-ai-card-sub">Optional: sends syllabus files to the AI service</div>
              </div>
            </div>
            <div class="umspec-ai-card-right">
              <label class="umspec-switch" title="Toggle AI Proforma Extraction">
                <input type="checkbox" id="umspec-ai-enable-chk" ${geminiEnabled ? 'checked' : ''} />
                <span class="umspec-slider"></span>
              </label>
            </div>
          </div>

</div>
          </section>
        </div>
        <p id="umspec-sync-status" class="umspec-notice" role="status" aria-live="polite"></p>
        <div class="umspec-modal-footer">
          <div class="umspec-footer-info" id="umspec-footer-stats"></div>
          <div class="umspec-footer-actions">
            <button class="umspec-btn-cancel" id="umspec-cancel-btn" type="button" style="display: none;">
              ${ICONS.close} <span>Cancel download</span>
            </button>
            <button class="umspec-btn-primary" id="umspec-start-btn" type="button">
              ${ICONS.download} <span>EXPORT</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Right Course Materials Flyout Inspector Drawer -->
      <div id="umspec-right-drawer">
        <div class="umspec-drawer-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="umspec-drawer-course-tag" id="umspec-right-course-code">COURSE</span>
            <span id="umspec-right-item-badge" style="font-family: var(--umspec-font-mono); font-size: 10px; color: var(--umspec-text-mid);">0 MATERIALS</span>
          </div>
          <button type="button" class="umspec-drawer-close-btn" id="umspec-right-close-btn" title="Close Inspector" aria-label="Close Inspector">${ICONS.close}</button>
        </div>
        <div class="umspec-drawer-title" id="umspec-right-course-title">Select a course to inspect</div>

        <!-- Filter Chips -->
        <div class="umspec-drawer-filters" id="umspec-right-filter-chips">
          <button type="button" class="umspec-filter-chip active" data-filter="all">ALL</button>
          <button type="button" class="umspec-filter-chip" data-filter="doc">DOCUMENTS</button>
          <button type="button" class="umspec-filter-chip" data-filter="video">VIDEOS</button>
          <button type="button" class="umspec-filter-chip" data-filter="external">STREAMING</button>
        </div>

        <!-- Actions Bar -->
        <div class="umspec-drawer-actions-bar">
          <span>SELECTION // [<span id="umspec-right-selected-count">0</span>/<span id="umspec-right-total-count">0</span> FILES SELECTED]</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button type="button" class="umspec-drawer-link" id="umspec-right-select-all" style="background: none; border: none; color: #ffffff; cursor: pointer; font-family: var(--umspec-font-mono); font-size: 9.5px; font-weight: 700;">SELECT ALL</button>
            <span class="umspec-sep" style="color: #475569;">//</span>
            <button type="button" class="umspec-drawer-link" id="umspec-right-deselect-all" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-family: var(--umspec-font-mono); font-size: 9.5px; font-weight: 700;">DESELECT</button>
          </div>
        </div>

        <!-- Materials List Scrollable Area -->
        <div class="umspec-drawer-scroll" id="umspec-right-materials-list">
          <div style="padding: 24px; text-align: center; color: #64748b; font-family: var(--umspec-font-mono); font-size: 10px;">
            SELECT A COURSE FROM THE MAIN PANEL TO INSPECT
          </div>
        </div>

        <!-- Drawer Footer -->
        <div class="umspec-drawer-footer">
          <div class="umspec-drawer-footer-metric">
            <span style="font-family: var(--umspec-font-mono); font-size: 9px; color: #94a3b8; text-transform: uppercase;">SELECTED SUMMARY</span>
            <span id="umspec-right-footer-summary" style="font-family: var(--umspec-font-mono); font-size: 10.5px; font-weight: 700; color: #ffffff;">0 Files Selected</span>
          </div>
          <button type="button" class="umspec-btn-drawer-done" id="umspec-right-done-btn">DONE</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-umspec-tab]').forEach(button => {
      button.addEventListener('click', () => showModalTab(button.dataset.umspecTab));
      button.addEventListener('keydown', event => {
        const tabs = [...overlay.querySelectorAll('[data-umspec-tab]')];
        let index = tabs.indexOf(button);
        if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = tabs.length - 1;
        else return;
        event.preventDefault(); showModalTab(tabs[index].dataset.umspecTab); tabs[index].focus();
      });
    });

    document.getElementById('umspec-close-modal').onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };

    document.getElementById('umspec-cancel-btn').onclick = abortExport;
    document.getElementById('umspec-export-back').onclick = () => {
      if (isExporting) return;
      runnerInstance?.stop('IDLE');
      document.getElementById('umspec-progress-card').style.display = 'none';
      setSelectionPanelCollapsed(false); renderCoursesList();
    };

    document.getElementById('umspec-select-all').onclick = () => {
      if (isExporting) return;
      selectedCourseIds = new Set(detectedCourses.map(c => c.id));
      renderCoursesList();
      recalculateSelectedVideoBytes();
    };

    document.getElementById('umspec-deselect-all').onclick = () => {
      if (isExporting) return;
      selectedCourseIds.clear();
      renderCoursesList();
      recalculateSelectedVideoBytes();
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

    // Right Flyout Drawer Listeners
    const rightCloseBtn = document.getElementById('umspec-right-close-btn') || document.getElementById('umspec-left-close-btn');
    const rightDoneBtn = document.getElementById('umspec-right-done-btn') || document.getElementById('umspec-left-done-btn');
    if (rightCloseBtn) rightCloseBtn.onclick = closeCourseInspector;
    if (rightDoneBtn) rightDoneBtn.onclick = closeCourseInspector;

    // Filter Chips in Right Drawer
    const filterChipsWrap = document.getElementById('umspec-right-filter-chips') || document.getElementById('umspec-left-filter-chips');
    if (filterChipsWrap) {
      filterChipsWrap.querySelectorAll('.umspec-filter-chip').forEach(btn => {
        btn.onclick = () => {
          filterChipsWrap.querySelectorAll('.umspec-filter-chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          rightDrawerFilter = btn.getAttribute('data-filter') || 'all';
          materialPage = 0;
          leftDrawerFilter = rightDrawerFilter;
          if (inspectingCourseId) {
            renderRightDrawerMaterials(inspectingCourseId);
          }
        };
      });
    }

    // Right Drawer Select All & Deselect All
    const rightSelectAllBtn = document.getElementById('umspec-right-select-all') || document.getElementById('umspec-left-select-all');
    const rightDeselectAllBtn = document.getElementById('umspec-right-deselect-all') || document.getElementById('umspec-left-deselect-all');
    if (rightSelectAllBtn) {
      rightSelectAllBtn.onclick = () => {
        if (!inspectingCourseId) return;
        const items = courseItemsCache.get(inspectingCourseId) || [];
        courseItemsSelected.set(inspectingCourseId, new Set(items.map(it => it.url)));
        renderRightDrawerMaterials(inspectingCourseId);
        updateCourseRowPill(inspectingCourseId);
        syncCourseMasterCheckbox(inspectingCourseId);
        recalculateSelectedVideoBytes();
      };
    }
    if (rightDeselectAllBtn) {
      rightDeselectAllBtn.onclick = () => {
        if (!inspectingCourseId) return;
        courseItemsSelected.set(inspectingCourseId, new Set());
        renderRightDrawerMaterials(inspectingCourseId);
        updateCourseRowPill(inspectingCourseId);
        syncCourseMasterCheckbox(inspectingCourseId);
        recalculateSelectedVideoBytes();
      };
    }

    // Enable/Disable AI Checkbox
    const aiEnableChk = document.getElementById('umspec-ai-enable-chk');
    if (aiEnableChk) {
      aiEnableChk.addEventListener('change', () => {
        if (aiEnableChk.checked && localStorage.getItem('umspec_ai_disclosure') !== '1') {
          const accepted = confirm('AI analysis sends selected proforma documents to the configured UM Spec proxy and Google Gemini. Continue?');
          if (!accepted) { aiEnableChk.checked = false; return; }
          localStorage.setItem('umspec_ai_disclosure', '1');
        }
        geminiEnabled = aiEnableChk.checked;
        localStorage.setItem('umspec_gemini_enabled', String(geminiEnabled));
      });
    }

    document.getElementById('umspec-start-btn').onclick = handleExportClick;

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
    window.addEventListener('resize', () => {
      if (!overlay.classList.contains('umspec-active')) return;
      renderCoursesList();
      if (inspectingCourseId) renderRightDrawerMaterials(inspectingCourseId);
      if (runnerInstance && document.getElementById('umspec-runner-canvas').getClientRects().length) {
        runnerInstance.resize();
        if (runnerInstance.state === 'SUCCESS') runnerInstance.drawSuccess();
        else if (runnerInstance.state === 'GAME_OVER') runnerInstance.drawGameOver();
      }
    });
  }

  // Open & Populate Modal
  async function openModal() {
    createModalDOM();
    const overlay = document.getElementById('umspec-modal-overlay');
    overlay.classList.add('umspec-active');
    showModalTab('courses');
    globalThis.UmSpecStudentSync?.refreshPanel?.();

    if (!isExporting) {
      setSelectionPanelCollapsed(false);
    }

    if (detectedCourses.length === 0) {
      detectedCourses = await discoverCourses();
      selectedCourseIds = new Set((globalThis.UmSpecStudentSync?.savedCourseIds?.() || detectedCourses.map(c => c.id)).map(Number));
    }
    if (!isExporting) {
      updateProfileUI();
      renderCoursesList();
    }
    backgroundScanAndProbeVideos();
  }

  function closeModal() {
    if (isExporting) {
      if (confirm('Export is currently running. Abort download?')) {
        abortExport();
      } else {
        return;
      }
    }
    closeCourseInspector();
    const advCard = document.getElementById('umspec-video-advisory-card');
    if (advCard) advCard.style.display = 'none';
    const overlay = document.getElementById('umspec-modal-overlay');
    if (overlay) overlay.classList.remove('umspec-active');
    document.getElementById('umspec-trigger-btn')?.focus?.();
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

    if (isExporting) return;
    startBtn.disabled = count === 0;
    startBtn.innerHTML = `${ICONS.download} <span>${destinationMode === 'drive' ? 'Sync to Drive' : 'Download ZIP'}</span>`;
  }

  // Parse activities from course HTML (shared by drawer, pre-flight analysis, and export)
  function parseCourseActivitiesFromHTML(cHtml, course) {
    const cDoc = new DOMParser().parseFromString(cHtml, 'text/html');
    if (cDoc.querySelector('form#login, input[name="password"]')) throw new Error('Spectrum session expired. Sign in again.');
    const items = [];
    const externalLinks = [];
    const seenUrls = new Set();

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

        if (isExternalVideoUrl(actUrl)) {
          externalLinks.push({ title: actName, url: actUrl, section: secName, isStreaming: true });
          items.push({
            name: actName,
            url: actUrl,
            type: modType,
            category: '7.Recordings & Media',
            section: secName,
            isVideo: true,
            isExternal: true,
            courseName: course?.fullName || '',
            courseFolder: course?.folderName || ''
          });
          return;
        }

        const extMatch = actUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        const ext = extMatch ? `.${extMatch[1]}` : '';
        const cat = classifyAdaptiveCategory(actName, secName, ext);
        const isVideo = isVideoActivity(actName, actUrl, modType, cat.id);
        const isProforma = /proforma|pro-forma|course outline|maklumat kursus|syllabus/i.test(actName);

        items.push({
          name: actName,
          url: actUrl,
          type: modType,
          category: cat.id,
          section: secName,
          isVideo,
          isProforma,
          courseName: course?.fullName || '',
          courseFolder: course?.folderName || ''
        });
      });

      sec.querySelectorAll('a[href*="youtu.be"], a[href*="youtube.com"], a[href*="drive.google.com"], a[href*="panopto."], a[href*="zoom.us"], a[href*="teams.microsoft.com"], a[href*="webex.com"], a[href*="echo360."], a[href*="vimeo.com"], a[href*="loom.com"]').forEach(ea => {
        if (!seenUrls.has(ea.href)) {
          seenUrls.add(ea.href);
          const title = ea.innerText.trim() || 'External Lecture Link';
          externalLinks.push({ title, url: ea.href, section: secName, isStreaming: true });
          items.push({
            name: title,
            url: ea.href,
            type: 'url',
            category: '7.Recordings & Media',
            section: secName,
            isVideo: true,
            isExternal: true,
            courseName: course?.fullName || '',
            courseFolder: course?.folderName || ''
          });
        }
      });
    });

    return { items, externalLinks };
  }

  // Fetch and parse activities for a specific course
  async function fetchAndParseCourseItems(courseId, signal) {
    const course = detectedCourses.find(c => c.id === courseId);
    const res = await fetchWithTimeout(
      `https://spectrum.um.edu.my/course/view.php?id=${courseId}`,
      { credentials: 'include', signal },
      15000
    );
    if (!res.ok) throw new Error('Spectrum course request failed (' + res.status + ').');
    const finalURL = new URL(res.url);
    if (finalURL.origin !== 'https://spectrum.um.edu.my' || /\/login(?:[/.]|$)/i.test(finalURL.pathname)) throw new Error('Sign in to Spectrum again.');
    const html = await res.text();
    const { items, externalLinks } = parseCourseActivitiesFromHTML(html, course);
    return { items, externalLinks };
  }

  // Update Course Row file count pill
  function updateCourseRowPill(courseId) {
    const pill = document.getElementById(`umspec-course-pill-${courseId}`);
    const items = courseItemsCache.get(courseId) || [];
    const set = courseItemsSelected.get(courseId) || new Set();
    const count = set.size;
    const total = items.length;

    if (pill) {
      pill.innerText = total > 0 ? `[${count}/${total} FILES]` : 'FILES';
    }
  }

  // Synchronize master course row checkbox with granular drawer items
  function syncCourseMasterCheckbox(courseId) {
    const chk = document.getElementById(`umspec-chk-${courseId}`);
    const row = document.getElementById(`umspec-row-${courseId}`);
    const set = courseItemsSelected.get(courseId) || new Set();
    if (set.size > 0) {
      selectedCourseIds.add(courseId);
      if (chk) chk.checked = true;
      if (row) row.classList.remove('umspec-row-unselected');
    } else {
      selectedCourseIds.delete(courseId);
      if (chk) chk.checked = false;
      if (row) row.classList.add('umspec-row-unselected');
    }
    updateSelectionUI();
  }

  // Close Course Materials Inspector Drawer
  function closeCourseInspector() {
    if (inspectingCourseId) {
      const activeRow = document.getElementById(`umspec-row-${inspectingCourseId}`);
      if (activeRow) activeRow.classList.remove('active-inspector');
    }
    inspectingCourseId = null;
    const drawer = document.getElementById('umspec-right-drawer') || document.getElementById('umspec-left-drawer');
    if (drawer) drawer.classList.remove('umspec-active');
  }

  // Open Course Materials Inspector Drawer (Right Panel)
  async function openCourseInspector(courseId) {
    if (isExporting) return;

    if (inspectingCourseId === courseId) {
      closeCourseInspector();
      return;
    }

    if (inspectingCourseId) {
      const prevRow = document.getElementById(`umspec-row-${inspectingCourseId}`);
      if (prevRow) prevRow.classList.remove('active-inspector');
    }

    inspectingCourseId = courseId;
    materialPage = 0;
    const row = document.getElementById(`umspec-row-${courseId}`);
    if (row) row.classList.add('active-inspector');

    const drawer = document.getElementById('umspec-right-drawer') || document.getElementById('umspec-left-drawer');
    if (drawer) drawer.classList.add('umspec-active');

    const course = detectedCourses.find(c => c.id === courseId);
    const codeTag = document.getElementById('umspec-right-course-code') || document.getElementById('umspec-left-course-code');
    const titleEl = document.getElementById('umspec-right-course-title') || document.getElementById('umspec-left-course-title');

    if (course) {
      const codeMatch = (course.fullName || '').match(/([A-Z]{3}\d{4})/i);
      if (codeTag) codeTag.innerText = codeMatch ? codeMatch[1].toUpperCase() : 'COURSE';
      if (titleEl) titleEl.innerText = course.fullName || 'Course Materials';
    }

    // If items not cached, fetch from SPeCTRUM
    if (!courseItemsCache.has(courseId)) {
      const scrollEl = document.getElementById('umspec-right-materials-list');
      if (scrollEl) {
        scrollEl.innerHTML = `
          <div style="padding: 32px 16px; text-align: center; color: #94a3b8; font-family: var(--umspec-font-mono); font-size: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
            ${ICONS.loader} <span>SCANNING COURSE MATERIALS &amp; VIDEOS...</span>
          </div>
        `;
      }
      try {
        const parsed = await fetchAndParseCourseItems(courseId);
        courseItemsCache.set(courseId, parsed.items);
        if (!courseItemsSelected.has(courseId)) {
          courseItemsSelected.set(courseId, new Set(parsed.items.map(it => it.url)));
        }
        updateCourseRowPill(courseId);
        // Background probe video sizes for this course
        probeCourseVideos(parsed.items);
      } catch (err) {
        const scrollEl = document.getElementById('umspec-right-materials-list');
        if (scrollEl) {
          scrollEl.innerHTML = `
            <div style="padding: 24px; text-align: center; color: #ef4444; font-size: 10px; font-family: var(--umspec-font-mono);">
              ${ICONS.alertCircle} FAILED TO LOAD COURSE MATERIALS: ${escapeHtml(err.message)}
            </div>
          `;
        }
        return;
      }
    }

    renderRightDrawerMaterials(courseId);
    recalculateSelectedVideoBytes();
  }

  // Render Material Items inside Right Inspector Drawer
  function renderRightDrawerMaterials(courseId) {
    const scrollEl = document.getElementById('umspec-right-materials-list');
    const badgeCount = document.getElementById('umspec-right-item-badge');
    const selCountEl = document.getElementById('umspec-right-selected-count');
    const totCountEl = document.getElementById('umspec-right-total-count');
    const footerSummary = document.getElementById('umspec-right-footer-summary');
    if (!scrollEl) return;

    const allItems = courseItemsCache.get(courseId) || [];
    const selectedSet = courseItemsSelected.get(courseId) || new Set();

    if (badgeCount) badgeCount.innerText = `${allItems.length} MATERIALS`;
    if (selCountEl) selCountEl.innerText = selectedSet.size;
    if (totCountEl) totCountEl.innerText = allItems.length;

    // Filter items based on active chip
    const activeFilter = rightDrawerFilter || leftDrawerFilter || 'all';
    const filteredItems = allItems.filter(item => {
      if (activeFilter === 'doc') return !item.isVideo && !item.isExternal;
      if (activeFilter === 'video') return item.isVideo && !item.isExternal;
      if (activeFilter === 'external') return item.isExternal;
      return true;
    });

    if (filteredItems.length === 0) {
      scrollEl.innerHTML = `
        <div style="padding: 32px 16px; text-align: center; color: #64748b; font-family: var(--umspec-font-mono); font-size: 10px;">
          NO MATERIALS FOUND IN THIS FILTER CATEGORY
        </div>
      `;
      return;
    }

    const pageSize = window.innerHeight < 650 ? 3 : 5;
    materialPage = Math.min(materialPage, Math.max(0, Math.ceil(filteredItems.length / pageSize) - 1));
    scrollEl.innerHTML = filteredItems.slice(materialPage * pageSize, (materialPage + 1) * pageSize).map((item, idx) => {
      const isChecked = selectedSet.has(item.url);
      let badgeHtml = '';
      if (item.isProforma) {
        badgeHtml = `<span class="umspec-item-badge umspec-badge-proforma">PROFORMA / SYLLABUS</span>`;
      } else if (item.isExternal) {
        badgeHtml = `<span class="umspec-item-badge umspec-badge-video" title="Direct link saved to Markdown">STREAMING LINK</span>`;
      } else if (item.isVideo) {
        const sizeTag = item.sizeBytes ? ` (~${formatBytes(item.sizeBytes)})` : '';
        badgeHtml = `<span class="umspec-item-badge umspec-badge-video">RECORDING${sizeTag}</span>`;
      } else {
        badgeHtml = `<span class="umspec-item-badge umspec-badge-regular">${escapeHtml(item.category.replace(/^\d+\./, ''))}</span>`;
      }

      const iconSvg = item.isVideo ? ICONS.video : (item.isProforma ? ICONS.fileText : ICONS.bookOpen);

      return `
        <div class="umspec-item-row ${isChecked ? '' : 'umspec-item-unselected'}" data-url="${escapeAttr(item.url)}" title="${escapeAttr(item.name)}">
          <div class="umspec-item-left">
            <label class="umspec-checkbox-label" for="umspec-right-chk-${idx}">
              <input type="checkbox" id="umspec-right-chk-${idx}" class="umspec-item-checkbox" data-url="${escapeAttr(item.url)}" ${isChecked ? 'checked' : ''} />
              <span class="umspec-custom-checkbox" aria-hidden="true">
                <svg class="umspec-check-glyph" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
              </span>
            </label>
            <span class="umspec-item-icon">${iconSvg}</span>
            <span class="umspec-item-name">${escapeHtml(item.name)}</span>
          </div>
          ${badgeHtml}
        </div>
      `;
    }).join('');

    addPageControls(scrollEl, filteredItems.length, materialPage, pageSize, page => { materialPage = page; renderRightDrawerMaterials(courseId); });

    // Attach row toggle listeners
    scrollEl.querySelectorAll('.umspec-item-row').forEach(row => {
      const url = row.getAttribute('data-url');
      const chk = row.querySelector('.umspec-item-checkbox');

      const toggleItem = (checked) => {
        let set = courseItemsSelected.get(courseId);
        if (!set) {
          set = new Set(allItems.map(it => it.url));
          courseItemsSelected.set(courseId, set);
        }
        if (checked) {
          set.add(url);
          row.classList.remove('umspec-item-unselected');
          if (chk) chk.checked = true;
        } else {
          set.delete(url);
          row.classList.add('umspec-item-unselected');
          if (chk) chk.checked = false;
        }
        if (selCountEl) selCountEl.innerText = set.size;
        updateCourseRowPill(courseId);
        syncCourseMasterCheckbox(courseId);
        recalculateSelectedVideoBytes();
      };

      if (chk) {
        chk.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleItem(e.target.checked);
        });
      }

      row.addEventListener('click', (e) => {
        if (e.target.closest('.umspec-checkbox-label')) return;
        const set = courseItemsSelected.get(courseId) || new Set();
        toggleItem(!set.has(url));
      });
    });

    if (footerSummary) {
      footerSummary.innerText = `${selectedSet.size} of ${allItems.length} Files Selected`;
    }
  }

  // Probe media size for video items in a course
  async function probeCourseVideos(items) {
    if (videoDownloadPreference !== 'include') return;
    if (!items || items.length === 0) return;
    for (const item of items) {
      if (item.isVideo && !item.isExternal && item.sizeBytes === undefined) {
        try {
          const probe = await probeMediaSize(item.url);
          item.sizeBytes = probe.sizeBytes;
          if (!probe.sizeBytes && !probe.isHtml) {
            item.sizeBytes = 120 * 1024 * 1024; // 120MB standard baseline
          }
        } catch (e) {
          item.sizeBytes = 120 * 1024 * 1024;
        }
      }
    }
    recalculateSelectedVideoBytes();
  }

  // Recalculate selected video sizes across all selected courses and update UI
  function recalculateSelectedVideoBytes() {
    let totalBytes = 0;
    let videoCount = 0;

    selectedCourseIds.forEach(courseId => {
      const items = courseItemsCache.get(courseId) || [];
      const selectedSet = courseItemsSelected.get(courseId) || new Set();

      items.forEach(item => {
        if (item.isVideo && !item.isExternal && selectedSet.has(item.url)) {
          videoCount++;
          totalBytes += (item.sizeBytes || (120 * 1024 * 1024));
        }
      });
    });

    const estSec = Math.ceil(totalBytes / (5 * 1024 * 1024));
    const sizeStr = formatBytes(totalBytes);
    const timeStr = formatEstimatedTime(estSec);

    // Update pill tag on Download button
    const estimateTag = document.getElementById('umspec-video-estimate-tag');
    if (estimateTag) {
      estimateTag.innerText = videoCount > 0 ? `(~${sizeStr} · ${timeStr})` : '';
    }

    // Update inline telemetry banner
    const stripEl = document.getElementById('umspec-video-telemetry-strip');
    const stripText = document.getElementById('umspec-video-telemetry-text');
    if (stripEl && stripText) {
      if (videoDownloadPreference === 'include' && videoCount > 0) {
        stripEl.style.display = 'flex';
        stripText.innerHTML = `MEDIA TELEMETRY // <b>${videoCount} Video${videoCount > 1 ? 's' : ''}</b> totaling <b>~${sizeStr}</b> · Est. <b>${timeStr}</b> via Campus Wi-Fi`;
      } else {
        stripEl.style.display = 'none';
      }
    }

    // Update Right Drawer footer if inspecting
    if (inspectingCourseId) {
      const set = courseItemsSelected.get(inspectingCourseId) || new Set();
      const all = courseItemsCache.get(inspectingCourseId) || [];
      const footerSummary = document.getElementById('umspec-right-footer-summary') || document.getElementById('umspec-left-footer-summary');
      if (footerSummary) {
        footerSummary.innerText = `${set.size} of ${all.length} Files Selected`;
      }
    }
  }

  // Background probe all detected courses for videos & item counts
  async function backgroundScanAndProbeVideos() {
    if (isProbingVideos || detectedCourses.length === 0) return;
    isProbingVideos = true;

    for (const course of detectedCourses) {
      if (!courseItemsCache.has(course.id)) {
        try {
          const parsed = await fetchAndParseCourseItems(course.id);
          courseItemsCache.set(course.id, parsed.items);
          if (!courseItemsSelected.has(course.id)) {
            courseItemsSelected.set(course.id, new Set(parsed.items.map(it => it.url)));
          }
          updateCourseRowPill(course.id);
          probeCourseVideos(parsed.items);
        } catch (e) {
          // Ignore background pre-scan errors
        }
      }
    }

    recalculateSelectedVideoBytes();
    isProbingVideos = false;
  }

  // Render Courses List (Pristine Custom Nothing Checkbox & Left Drawer Trigger)
  function renderCoursesList() {
    const container = document.getElementById('umspec-courses-container');
    const countEl = document.getElementById('umspec-course-count');
    if (!container) return;

    if (detectedCourses.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--umspec-red, #d71921); font-family: var(--umspec-font-mono); font-size: 11px; letter-spacing: 0.08em; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${ICONS.alertCircle} <span>No courses found. Check that you are signed in to Spectrum.</span>
        </div>
      `;
      if (countEl) countEl.innerText = '0';
      updateSelectionUI();
      return;
    }

    const pageSize = (window.innerHeight < 650 ? 3 : 5) - (document.getElementById('umspec-progress-card')?.style.display === 'block' ? 1 : 0);
    coursePage = Math.min(coursePage, Math.max(0, Math.ceil(detectedCourses.length / pageSize) - 1));
    container.innerHTML = detectedCourses.slice(coursePage * pageSize, (coursePage + 1) * pageSize).map(c => {
      const isSelected = selectedCourseIds.has(c.id);
      const isInspecting = inspectingCourseId === c.id;
      const cachedItems = courseItemsCache.get(c.id);
      const selectedSet = courseItemsSelected.get(c.id);
      const countLabel = cachedItems
        ? `[${selectedSet ? selectedSet.size : cachedItems.length}/${cachedItems.length} FILES]`
        : 'FILES';

      return `
        <div class="umspec-course-group" id="umspec-group-${c.id}">
          <div class="umspec-course-row ${isSelected ? '' : 'umspec-row-unselected'} ${isInspecting ? 'active-inspector' : ''}" id="umspec-row-${c.id}" data-id="${c.id}">
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
                <div class="umspec-course-title" id="umspec-title-${c.id}" title="${escapeAttr(c.fullName)}">${escapeHtml(c.fullName)}</div>
              </div>
            </div>
            <div class="umspec-course-actions">
              <button type="button" class="umspec-course-files-btn" id="umspec-inspect-btn-${c.id}" data-id="${c.id}" title="Choose files for this course">
                <span id="umspec-course-pill-${c.id}">${countLabel}</span>
                <span class="umspec-files-arrow">${ICONS.chevronRight}</span>
              </button>
              <span class="umspec-course-status" id="umspec-status-${c.id}" style="display: none;">READY</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    addPageControls(container, detectedCourses.length, coursePage, pageSize, page => { coursePage = page; renderCoursesList(); });

    // Attach row toggle and drawer inspector handlers
    container.querySelectorAll('.umspec-course-row').forEach(row => {
      const id = parseInt(row.getAttribute('data-id'));
      const chk = row.querySelector('.umspec-course-checkbox');
      const inspectBtn = row.querySelector(`#umspec-inspect-btn-${id}`);

      const toggleRow = (select) => {
        if (isExporting) return;
        if (select) {
          selectedCourseIds.add(id);
          row.classList.remove('umspec-row-unselected');
          if (chk) chk.checked = true;
          if (courseItemsCache.has(id) && (!courseItemsSelected.has(id) || courseItemsSelected.get(id).size === 0)) {
            const items = courseItemsCache.get(id);
            courseItemsSelected.set(id, new Set(items.map(it => it.url)));
            updateCourseRowPill(id);
          }
        } else {
          selectedCourseIds.delete(id);
          row.classList.add('umspec-row-unselected');
          if (chk) chk.checked = false;
        }
        updateSelectionUI();
        recalculateSelectedVideoBytes();
      };

      if (chk) {
        chk.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleRow(e.target.checked);
        });
      }

      if (inspectBtn) {
        inspectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCourseInspector(id);
        });
      }

      row.addEventListener('click', (e) => {
        if (e.target.closest('.umspec-checkbox-label') || e.target.closest('.umspec-course-files-btn')) return;
        openCourseInspector(id);
      });
    });

    updateSelectionUI();
  }

  // Helper: Fetch with dedicated per-request timeout
  async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Network timeout of ${Math.round(timeoutMs / 1000)}s reached`));
    }, timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw options.signal.reason || new Error('Aborted');
      }
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort(options.signal.reason);
      }, { once: true });
    }

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // Helper: Probe media size using HEAD or Range request with short timeout
  async function probeMediaSize(url, signal) {
    if (!url || isExternalVideoUrl(url) || (!url.includes('spectrum.um.edu.my') && !url.startsWith('/'))) {
      return { sizeBytes: 0, isExternal: true, isHtml: false };
    }

    try {
      const res = await fetchWithTimeout(url, {
        method: 'HEAD',
        credentials: 'include',
        signal
      }, 6000);

      if (res.ok) {
        const ct = (res.headers.get('Content-Type') || '').toLowerCase();
        const cl = res.headers.get('Content-Length');
        const sizeBytes = cl ? parseInt(cl, 10) : 0;
        return {
          sizeBytes: isNaN(sizeBytes) ? 0 : sizeBytes,
          contentType: ct,
          isHtml: ct.includes('text/html')
        };
      }
    } catch (e) {
      // HEAD may fail, fallback to Range probe
    }

    try {
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-0' },
        credentials: 'include',
        signal
      }, 6000);

      if (res.ok || res.status === 206) {
        const ct = (res.headers.get('Content-Type') || '').toLowerCase();
        const cr = res.headers.get('Content-Range') || '';
        const m = cr.match(/\/(\d+)/);
        let sizeBytes = m ? parseInt(m[1], 10) : 0;
        if (!sizeBytes) {
          const cl = res.headers.get('Content-Length');
          sizeBytes = cl ? parseInt(cl, 10) : 0;
        }
        return {
          sizeBytes: isNaN(sizeBytes) ? 0 : sizeBytes,
          contentType: ct,
          isHtml: ct.includes('text/html')
        };
      }
    } catch (e2) {
      // Range probe failed
    }

    return { sizeBytes: 0, contentType: '', isHtml: false };
  }

  // Helper: Fetch binary data with abort signal, timeout protection & stream reporting
  async function fetchBinary(url, defaultName, signal, onProgress, skipVideos = false) {
    if (isExternalVideoUrl(url) || (!url.includes('spectrum.um.edu.my') && !url.startsWith('/'))) {
      return { isExternal: true, url, filename: defaultName };
    }

    const res = await fetchWithTimeout(url, { credentials: 'include', signal }, 45000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (skipVideos && globalThis.UmSpecSync.isVideoMaterial({ url: res.url, name: defaultName, mimeType: ct })) {
      await res.body?.cancel();
      return { isExternal: true, url: res.url, filename: defaultName };
    }
    if (ct.includes('text/html')) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const extVideoLink = doc.querySelector('a[href*="panopto"], a[href*="zoom.us"], a[href*="youtube.com"], a[href*="youtu.be"], a[href*="drive.google.com"], iframe[src*="panopto"], iframe[src*="youtube"]');
      if (extVideoLink) {
        const extUrl = extVideoLink.getAttribute('src') || extVideoLink.getAttribute('href');
        return { isExternal: true, url: extUrl, filename: defaultName };
      }

      const realLink = doc.querySelector('.resourceworkaround a, .resourcecontent object, a[href*="pluginfile.php"]');
      if (realLink) {
        const nextUrl = realLink.getAttribute('data') || realLink.getAttribute('href');
        if (nextUrl) {
          if (isExternalVideoUrl(nextUrl) || !nextUrl.includes('spectrum.um.edu.my')) {
            return { isExternal: true, url: nextUrl, filename: defaultName };
          }
          if (nextUrl.includes('pluginfile.php')) {
            return fetchBinary(nextUrl, defaultName, signal, onProgress, skipVideos);
          }
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

    const totalBytes = parseInt(res.headers.get('Content-Length') || '0', 10);
    const reader = res.body?.getReader();

    if (!reader) {
      const data = await res.arrayBuffer();
      return { filename: sanitizeName(filename), data };
    }

    const chunks = [];
    let receivedBytes = 0;

    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        throw new Error('Aborted by user');
      }

      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.length;

      if (onProgress && totalBytes > 0) {
        onProgress(receivedBytes, totalBytes);
      }
    }

    const data = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }

    return { filename: sanitizeName(filename), data: data.buffer };
  }

  // Gemini AI Client with Multi-Key Load Balancing, Backend Proxy, and Fallback Cascade
  async function callGeminiWithLoadBalancing(prompt, pdfBase64 = null, onStatus = null) {
    // Determine cascade sequence based on user configuration
    const primary = geminiPrimaryModel === 'custom'
      ? (geminiCustomPrimary.trim() || 'gemini-2.0-flash-lite')
      : geminiPrimaryModel;

    const fallback = geminiFallbackModel === 'custom'
      ? (geminiCustomFallback.trim() || 'gemini-1.5-flash')
      : geminiFallbackModel;

    // 1. If user configured a Backend Proxy Endpoint (Chrome Web Store Best Practice), try it first:
    if (backendEndpointUrl) {
      const cleanUrl = backendEndpointUrl.replace(/\/+$/, '');
      try {
        if (onStatus) onStatus(`[AI] Calling secure backend proxy: ${cleanUrl}...`);
        console.log(`[UmSpec AI] Calling backend proxy at ${cleanUrl}/api/analyze-proforma`);

        const res = await fetchWithTimeout(`${cleanUrl}/api/analyze-proforma`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            pdfBase64,
            primaryModel: primary,
            fallbackModel: fallback
          })
        }, 40000);

        if (res.ok) {
          const data = await res.json();
          if (data && data.text) {
            return {
              text: data.text,
              modelUsed: data.modelUsed || primary,
              keyIndexUsed: data.keyIndexUsed || 0
            };
          }
        }
        const errText = await res.text();
        console.warn(`[UmSpec AI] Backend proxy returned error (HTTP ${res.status}): ${errText}`);
        if (!geminiApiKeyPool || geminiApiKeyPool.length === 0) {
          throw new Error(`Backend proxy failed (HTTP ${res.status}): ${errText.slice(0, 120)}`);
        }
      } catch (backendErr) {
        console.warn('[UmSpec AI] Backend proxy failed, checking for local key pool failover...', backendErr);
        if (!geminiApiKeyPool || geminiApiKeyPool.length === 0) {
          throw backendErr;
        }
        if (onStatus) onStatus(`[AI] Backend proxy offline. Falling back to local key pool...`);
      }
    }

    // 2. Direct local key pool cascade (for offline dev or personal usage)
    if (!geminiApiKeyPool || geminiApiKeyPool.length === 0) {
      throw new Error('AI backend server offline. Please ensure your backend service is running.');
    }

    const modelsToTry = [
      primary,
      fallback,
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    console.log('[UmSpec AI] Starting direct Gemini request cascade. Models in order:', modelsToTry, 'Keys:', geminiApiKeyPool.length);

    let lastError = null;

    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const currentModel = modelsToTry[mIdx];
      const isFallback = mIdx > 0;
      if (isFallback) {
        const msg = `[AI] Primary model exhausted/unavailable. Cascading to fallback model: ${currentModel}...`;
        console.warn(msg);
        if (onStatus) onStatus(msg);
      }

      let consecutive429Count = 0;

      for (let k = 0; k < geminiApiKeyPool.length; k++) {
        const keyIndex = (currentKeyIndex + k) % geminiApiKeyPool.length;
        const apiKey = geminiApiKeyPool[keyIndex];

        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

          const parts = [{ text: prompt }];
          if (pdfBase64) {
            parts.push({
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfBase64
              }
            });
          }

          const requestBody = {
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          };

          const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          }, 35000);

          if (res.ok) {
            const data = await res.json();
            currentKeyIndex = (keyIndex + 1) % geminiApiKeyPool.length;
            const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textResponse) throw new Error('Empty text content received from Gemini API');
            return {
              text: textResponse,
              modelUsed: currentModel,
              keyIndexUsed: keyIndex
            };
          }

          if (res.status === 429) {
            consecutive429Count++;
            const warnMsg = `[AI] Key #${keyIndex + 1} reached quota / 429 on ${currentModel}. Rotating to next key in pool...`;
            console.warn(warnMsg);
            if (onStatus) onStatus(warnMsg);
            lastError = new Error(`Quota limit (429) on key #${keyIndex + 1}`);
            continue;
          }

          if (res.status === 404 || res.status === 400) {
            const errText = await res.text();
            console.warn(`[AI] Model '${currentModel}' not found or rejected (HTTP ${res.status}): ${errText.slice(0, 100)}. Cascading to next model...`);
            lastError = new Error(`Model ${currentModel} returned ${res.status}`);
            break;
          }

          const errBody = await res.text();
          console.warn(`[AI] API call failed on ${currentModel} with status ${res.status}: ${errBody}`);
          lastError = new Error(`HTTP ${res.status}: ${errBody.slice(0, 100)}`);
        } catch (callErr) {
          console.warn(`[AI] Network or fetch error on key #${keyIndex + 1} for ${currentModel}:`, callErr);
          lastError = callErr;
        }
      }

      if (consecutive429Count >= geminiApiKeyPool.length) {
        const exhaustMsg = `[AI] All ${geminiApiKeyPool.length} keys exhausted on ${currentModel}. Cascading to fallback model...`;
        console.warn(exhaustMsg);
        if (onStatus) onStatus(exhaustMsg);
      }
    }

    throw lastError || new Error('All Gemini models and API keys failed.');
  }

  // Scan and analyze course proforma PDFs using Gemini
  async function analyzeCourseProformas(coursesToExport, signal, statusEl) {
    if (!geminiEnabled) {
      return null;
    }

    const allDeadlines = [];

    for (const course of coursesToExport) {
      if (signal?.aborted) break;

      // Ensure we have items for this course
      let items = courseItemsCache.get(course.id);
      if (!items) {
        try {
          const parsed = await fetchAndParseCourseItems(course.id);
          items = parsed.items;
          courseItemsCache.set(course.id, items);
        } catch (e) {
          items = [];
        }
      }

      const cleanCode = (course.folderName.split('_')[0] || '').toUpperCase().trim();

      // 1. Campus Cache-First Check: If backend proxy is configured, check shared global cache
      if (backendEndpointUrl && cleanCode) {
        try {
          const cleanUrl = backendEndpointUrl.replace(/\/+$/, '');
          const cacheRes = await fetchWithTimeout(`${cleanUrl}/api/v1/course/${encodeURIComponent(cleanCode)}/deadlines`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          }, 5000);

          if (cacheRes.ok) {
            const cachedData = await cacheRes.json();
            if (cachedData && Array.isArray(cachedData.assessments) && cachedData.assessments.length > 0) {
              console.log(`[UmSpec AI] Campus Cache HIT for ${cleanCode} (${cachedData.assessments.length} assessments). Reused zero-cost global cache!`);
              if (statusEl) {
                statusEl.innerText = `[AI] Instant Cache HIT: ${cleanCode} (Global Campus Cache)`;
              }
              allDeadlines.push({
                courseCode: cachedData.courseCode || cleanCode,
                courseName: cachedData.courseName || course.fullName,
                assessments: cachedData.assessments,
                modelUsed: `${cachedData.modelUsed || 'Gemini'} (Campus Cache)`,
                summary: cachedData.summary || ''
              });
              continue; // Skip proforma download & LLM inference completely!
            }
          }
        } catch (cacheErr) {
          console.log(`[UmSpec AI] Campus cache check skipped for ${cleanCode}:`, cacheErr.message);
        }
      }

      // Find proforma item
      const proformaItem = items.find(it => it.isProforma || /proforma|pro-forma|outline|maklumat|syllabus/i.test(it.name));
      if (!proformaItem) continue;

      if (statusEl) {
        statusEl.innerText = `[AI] Extracting Proforma: ${course.folderName}...`;
      }

      try {
        const binRes = await fetchBinary(proformaItem.url, proformaItem.name, signal);
        if (!binRes || !binRes.data) continue;

        const base64Data = arrayBufferToBase64(binRes.data);

        // 2. Try decentralized ingestion via backend proxy
        if (backendEndpointUrl && cleanCode) {
          try {
            const cleanUrl = backendEndpointUrl.replace(/\/+$/, '');
            if (statusEl) statusEl.innerText = `[AI] Ingesting into Campus Cache: ${cleanCode}...`;
            const ingestRes = await fetchWithTimeout(`${cleanUrl}/api/v1/ingest/course`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                courseCode: cleanCode,
                courseName: course.fullName,
                academicYear: studentProfile?.yearSem || 'CURRENT',
                faculty: studentProfile?.faculty || '',
                pdfBase64: base64Data
              })
            }, 45000);

            if (ingestRes.ok) {
              const ingestData = await ingestRes.json();
              if (ingestData && Array.isArray(ingestData.assessments) && ingestData.assessments.length > 0) {
                allDeadlines.push({
                  courseCode: ingestData.courseCode || cleanCode,
                  courseName: ingestData.courseName || course.fullName,
                  assessments: ingestData.assessments,
                  modelUsed: `${ingestData.modelUsed} (Ingested to Campus Cache)`,
                  summary: ingestData.summary || ''
                });
                console.log(`[UmSpec AI] Successfully ingested ${cleanCode} into Campus Cache!`);
                continue;
              }
            }
          } catch (ingestErr) {
            console.warn(`[UmSpec AI] Ingest endpoint failed, falling back to legacy prompt cascade:`, ingestErr);
          }
        }

        const prompt = `You are an academic analysis assistant for Universiti Malaya (UM).
Analyze this official Course Proforma / Course Outline document for "${course.fullName}".
Extract:
1. Course code and official course name.
2. Continuous assessment components (Assignments, Quizzes, Lab Tests, Mid-Terms, Presentations, Projects, Final Examination).
3. Weightage percentage (e.g. "10%", "20%").
4. Due week (e.g. "Week 5", "Week 12") and estimated date if specified.
5. Brief description of requirements.

Output STRICTLY a JSON object with this exact structure:
{
  "courseCode": "${course.folderName.split('_')[0] || 'COURSE'}",
  "courseName": "${course.fullName}",
  "assessments": [
    {
      "name": "Assignment 1",
      "type": "Assignment",
      "weightage": "15%",
      "dueWeek": "Week 6",
      "estimatedDate": "2026-11-15",
      "description": "Short description of deliverable"
    }
  ]
}`;

        const aiResult = await callGeminiWithLoadBalancing(prompt, base64Data, (msg) => {
          if (statusEl) statusEl.innerText = msg;
        });

        if (aiResult?.text) {
          let parsed = null;
          try {
            const cleanJson = aiResult.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            parsed = JSON.parse(cleanJson);
          } catch (jsonErr) {
            console.warn('[UmSpec AI] Failed to parse JSON:', jsonErr, aiResult.text);
          }

          if (parsed && Array.isArray(parsed.assessments)) {
            allDeadlines.push({
              courseCode: parsed.courseCode || course.folderName,
              courseName: parsed.courseName || course.fullName,
              assessments: parsed.assessments,
              modelUsed: aiResult.modelUsed
            });
            console.log(`[UmSpec AI] Extracted ${parsed.assessments.length} assessment milestones for ${course.folderName}`);
          }
        }
      } catch (err) {
        console.warn(`[UmSpec AI] Proforma extraction failed for course ${course.folderName}:`, err);
      }
    }

    return allDeadlines.length > 0 ? allDeadlines : null;
  }

  // Generate Markdown summary for deadlines
  function generateDeadlinesMarkdown(deadlines) {
    let md = `# Universiti Malaya - Semester Deadlines & Continuous Assessment Matrix\n\n`;
    md += `> **Auto-Generated by UmSpec AI Pro Engine** on ${new Date().toLocaleString()}\n`;
    md += `> AI Models Load-Balanced: Multi-Key Pool with Fallback Cascade\n\n`;
    md += `---\n\n`;

    md += `## Executive Timeline Overview\n\n`;
    md += `| Course | Assessment / Milestone | Type | Weight | Due Week / Date | Status |\n`;
    md += `| :--- | :--- | :---: | :---: | :---: | :---: |\n`;

    deadlines.forEach(d => {
      d.assessments.forEach(a => {
        const dateStr = a.estimatedDate ? ` (${a.estimatedDate})` : '';
        const due = `${a.dueWeek || 'TBA'}${dateStr}`;
        md += `| **${d.courseCode}** | ${a.name} | ${a.type || 'Assessment'} | ${a.weightage || 'N/A'} | ${due} | [ ] Pending |\n`;
      });
    });

    md += `\n---\n\n## Course-by-Course Assessment Breakdown\n\n`;

    deadlines.forEach(d => {
      md += `### ${d.courseCode}: ${d.courseName}\n\n`;
      d.assessments.forEach((a, idx) => {
        md += `- [ ] **${a.name}** (${a.weightage || 'N/A'})\n`;
        md += `  - **Category:** ${a.type || 'Assessment'}\n`;
        md += `  - **Target Timeline:** ${a.dueWeek || 'TBA'}${a.estimatedDate ? ` [${a.estimatedDate}]` : ''}\n`;
        if (a.description) {
          md += `  - **Details:** ${a.description}\n`;
        }
      });
      md += `\n`;
    });

    md += `\n---\n*AI dates are suggestions. Only reviewed, confirmed dates are included in the calendar file. Importing a file is a one-time copy; use Google Calendar sync for updates.* \n`;
    return md;
  }

  // Generate iCalendar (.ics) RFC 5545 file
  async function generateDeadlinesICS(deadlines) {
    // AI suggestions stay in Markdown until explicitly reviewed; no guessed dates in calendars.
    const confirmed = [];
    for (const course of deadlines) {
      for (const item of course.assessments || []) {
        if (item.status !== 'confirmed' || !item.sourceKey || !item.sourceUrl) continue;
        confirmed.push({ ...item, courseId: String(item.courseId || course.courseCode),
          sourceType: 'proforma', timeZone: 'Asia/Kuala_Lumpur' });
      }
    }
    return globalThis.UmSpecCalendarCore.generateICS(confirmed, new Date());
  }
  // Analyze video materials and sizes across selected courses before exporting
  async function analyzeSelectedCourses(coursesToAnalyze, signal) {
    const courseDataMap = new Map();
    const videoItems = [];
    let totalVideoBytes = 0;

    for (let i = 0; i < coursesToAnalyze.length; i++) {
      if (signal?.aborted) break;
      const course = coursesToAnalyze[i];

      try {
        const cRes = await fetchWithTimeout(
          `https://spectrum.um.edu.my/course/view.php?id=${course.id}`,
          { credentials: 'include', signal },
          15000
        );
        const cHtml = await cRes.text();
        const { items, externalLinks } = parseCourseActivitiesFromHTML(cHtml, course);

        courseItemsCache.set(course.id, items);
        if (!courseItemsSelected.has(course.id)) {
          courseItemsSelected.set(course.id, new Set(items.map(it => it.url)));
        }

        items.forEach(it => {
          if (it.isVideo && !it.isExternal) {
            videoItems.push(it);
          }
        });

        courseDataMap.set(course.id, {
          course,
          itemsToDownload: items,
          externalLinks
        });
      } catch (err) {
        console.warn(`[UmSpec] Pre-scan failed for course ${course.id}:`, err);
      }
    }

    // Probe video items for Content-Length (short timeout)
    if (videoItems.length > 0) {
      for (const vItem of videoItems) {
        if (signal?.aborted) break;
        const probe = await probeMediaSize(vItem.url, signal);
        vItem.sizeBytes = probe.sizeBytes;
        vItem.isHtml = probe.isHtml;
        if (probe.sizeBytes > 0) {
          totalVideoBytes += probe.sizeBytes;
        } else if (!probe.isHtml && !probe.isExternal) {
          totalVideoBytes += 120 * 1024 * 1024;
          vItem.estimated = true;
        }
      }
    }

    const estimatedSeconds = Math.ceil(totalVideoBytes / (5 * 1024 * 1024));

    return {
      courseDataMap,
      videoItems,
      videoCount: videoItems.length,
      totalVideoBytes,
      estimatedSeconds
    };
  }

  // Handle Export button click with pre-export analysis and video advisory
  async function handleExportClick() {
    if (globalThis.UmSpecStudentSync) {
      try { if (await globalThis.UmSpecStudentSync.exportOrSync()) return; }
      catch (error) { alert(error.message || 'Sync paused. Check your sync settings.'); return; }
    }
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

    // If user explicitly chose "skip" (Fast):
    if (videoDownloadPreference === 'skip') {
      runZeroTouchExport({ skipVideos: true });
      return;
    }

    // User chose "include" or hasn't confirmed -> Analyze video sizes first
    const startBtn = document.getElementById('umspec-start-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = `${ICONS.loader} <span>ANALYZING VIDEO SIZES...</span>`;

    const cancelBtn = document.getElementById('umspec-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    abortController = new AbortController();

    try {
      const analysis = await analyzeSelectedCourses(coursesToExport, abortController.signal);

      // If no video recordings found:
      if (analysis.videoCount === 0 || analysis.totalVideoBytes === 0) {
        runZeroTouchExport({ skipVideos: false, cachedData: analysis.courseDataMap });
        return;
      }

      // Large video recordings found! Show Nothing OS Video Advisory Card
      const advCard = document.getElementById('umspec-video-advisory-card');
      const advCount = document.getElementById('umspec-advisory-count');
      const advSize = document.getElementById('umspec-advisory-size');
      const advTime = document.getElementById('umspec-advisory-time');
      const metricVideos = document.getElementById('umspec-metric-videos');
      const metricSize = document.getElementById('umspec-metric-size');
      const metricTime = document.getElementById('umspec-metric-time');

      const sizeStr = formatBytes(analysis.totalVideoBytes);
      const timeStr = formatEstimatedTime(analysis.estimatedSeconds);

      if (advCount) advCount.innerText = `${analysis.videoCount} Video Recording${analysis.videoCount > 1 ? 's' : ''}`;
      if (advSize) advSize.innerText = sizeStr;
      if (advTime) advTime.innerText = `EST. ${timeStr}`;
      if (metricVideos) metricVideos.innerText = `${analysis.videoCount}`;
      if (metricSize) metricSize.innerText = sizeStr;
      if (metricTime) metricTime.innerText = timeStr;

      if (advCard) {
        advCard.style.display = 'block';
        advCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      const btnSkip = document.getElementById('umspec-btn-advisory-skip');
      const btnInclude = document.getElementById('umspec-btn-advisory-include');

      if (btnSkip) {
        btnSkip.onclick = () => {
          if (advCard) advCard.style.display = 'none';
          runZeroTouchExport({ skipVideos: true, cachedData: analysis.courseDataMap });
        };
      }

      if (btnInclude) {
        btnInclude.onclick = () => {
          if (advCard) advCard.style.display = 'none';
          runZeroTouchExport({ skipVideos: false, cachedData: analysis.courseDataMap });
        };
      }

    } catch (err) {
      if (err.name === 'AbortError' || !isExporting) {
        console.log('[UmSpec] Video analysis aborted by user');
        return;
      }
      console.warn('[UmSpec] Video pre-flight analysis error:', err);
      runZeroTouchExport({ skipVideos: false });
    } finally {
      if (!isExporting) {
        startBtn.disabled = false;
        updateSelectionUI();
        if (cancelBtn) cancelBtn.style.display = 'none';
      }
    }
  }

  // Zero-Touch Smart Export Pipeline with Live Dino Runner & Abort Handling
  async function runZeroTouchExport(options = {}) {
    if (isExporting) return;
    const skipVideos = options.skipVideos === undefined ? videoDownloadPreference !== 'include' : Boolean(options.skipVideos);
    const cachedData = options.cachedData || null;

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

    const advCard = document.getElementById('umspec-video-advisory-card');
    if (advCard) advCard.style.display = 'none';

    const runId = ++exportRunId;
    const currentController = new AbortController();
    const active = () => isExporting && runId === exportRunId && !currentController.signal.aborted;
    isExporting = true;
    abortController = currentController;
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
    if (canvasEl && !runnerInstance) runnerInstance = new UmSpecDragonRunner(canvasEl, scoreEl);
    const backBtn = document.getElementById('umspec-export-back');
    if (backBtn) backBtn.disabled = true;

    fillEl.style.background = '#ffffff';
    statusEl.style.color = '';

    const zip = new JSZip();
    let totalFiles = 0;
    let totalBytes = 0;
    const auditRows = [];
    const discoveredCategories = new Set();

    try {
      if (runnerInstance) {
        try { await runnerInstance.start(); }
        catch (error) { if (scoreEl && active()) scoreEl.innerText = 'Dino unavailable — export continues'; }
      }
      if (!active()) return;
      if (canvasEl && (document.activeElement === startBtn || document.activeElement === document.body)) canvasEl.focus({ preventScroll: true });
      // Phase 1: Proforma & Continuous Assessment AI Extraction (if enabled)
      let extractedDeadlines = null;
      if (geminiEnabled && (backendEndpointUrl || geminiApiKeyPool.length > 0)) {
        try {
          statusEl.innerText = 'Scanning proformas & extracting deadlines with Gemini AI...';
          extractedDeadlines = await analyzeCourseProformas(coursesToExport, currentController.signal, statusEl);
          if (extractedDeadlines && extractedDeadlines.length > 0) {
            const mdContent = generateDeadlinesMarkdown(extractedDeadlines);
            const icsContent = await generateDeadlinesICS(extractedDeadlines);
            zip.file('DEADLINES_AND_MILESTONES.md', mdContent);
            zip.file('semester_deadlines.ics', icsContent);
            totalFiles += 2;
            console.log('[UmSpec AI] Successfully generated DEADLINES_AND_MILESTONES.md and semester_deadlines.ics');
          }
        } catch (aiErr) {
          console.warn('[UmSpec AI] Proforma deadline extraction encountered error:', aiErr);
        }
      }

      for (let i = 0; i < coursesToExport.length; i++) {
        if (!active()) break;

        const course = coursesToExport[i];
        const statusBadge = document.getElementById(`umspec-status-${course.id}`);
        if (statusBadge) {
          statusBadge.innerText = 'SCANNING';
          statusBadge.style.color = '#ffffff';
        }

        statusEl.innerText = `Analyzing course ${i + 1}/${coursesToExport.length}: ${course.fullName}...`;

        let itemsToDownload = [];
        let externalLinks = [];

        if (cachedData && cachedData.has(course.id)) {
          const cData = cachedData.get(course.id);
          itemsToDownload = [...(cData.itemsToDownload || [])];
          externalLinks = [...(cData.externalLinks || [])];
        } else if (courseItemsCache.has(course.id)) {
          itemsToDownload = [...(courseItemsCache.get(course.id) || [])];
        } else {
          const cRes = await fetchWithTimeout(`https://spectrum.um.edu.my/course/view.php?id=${course.id}`, {
            credentials: 'include',
            signal: currentController.signal
          }, 15000);
          const cHtml = await cRes.text();
          const parsed = parseCourseActivitiesFromHTML(cHtml, course);
          itemsToDownload = parsed.items;
          externalLinks = parsed.externalLinks;
          courseItemsCache.set(course.id, itemsToDownload);
        }

        // Apply granular file/video selections if customized by user
        if (courseItemsSelected.has(course.id)) {
          const selectedSet = courseItemsSelected.get(course.id);
          itemsToDownload = itemsToDownload.filter(it => selectedSet.has(it.url));
        }

        itemsToDownload.forEach(item => {
          const cat = classifyAdaptiveCategory(item.name, item.section, '');
          discoveredCategories.add(cat.label);
        });

        if (statusBadge) {
          statusBadge.innerText = `FETCHING (${itemsToDownload.length})`;
          statusBadge.style.color = '#ffffff';
        }

        let courseDownloadedCount = 0;

        for (let j = 0; j < itemsToDownload.length; j++) {
          if (!active()) break;

          const item = itemsToDownload[j];
          statusEl.innerText = `[${course.folderName}] (${j + 1}/${itemsToDownload.length}) ${item.name}`;

          const progressVal = Math.round(((i + (j / Math.max(1, itemsToDownload.length))) / coursesToExport.length) * 100);
          fillEl.style.width = `${progressVal}%`;
          percentEl.innerText = `${progressVal}%`;

          // Accelerate runner speed as download progresses
          if (runnerInstance && runnerInstance.state === 'RUNNING') {
            runnerInstance.speed = 4.2 + (progressVal / 100) * 2.8;
          }

          // If skipping videos: save direct link to externalLinks instead of downloading heavy binary
          if (item.isVideo && skipVideos) {
            externalLinks.push({
              title: `${item.name} (Lecture Recording - Direct Link)`,
              url: item.url,
              section: item.section
            });
            continue;
          }

          try {
            const files = await globalThis.UmSpecMaterials.resolveItemFiles(item, currentController.signal, skipVideos ? 'links' : 'include');
            for (const file of files) {
              if (!active()) break;
              if (file.kind === 'link') {
                externalLinks.push({ title: file.name, url: file.url, section: item.section });
                continue;
              }
              const fData = await fetchBinary(file.url, file.name, currentController.signal, undefined, skipVideos);
              if (fData?.data) {
                let path = course.folderName + '/' + item.category + '/' + fData.filename;
                if (zip.file(path)) {
                  const suffix = (await globalThis.UmSpecSync.hashParts([item.url, file.url])).slice(0, 8);
                  path = course.folderName + '/' + item.category + '/' + suffix + '_' + fData.filename;
                }
                zip.file(path, fData.data);
                totalFiles++; totalBytes += fData.data.byteLength; courseDownloadedCount++;
              } else if (fData?.isExternal) {
                externalLinks.push({ title: fData.filename, url: fData.url, section: item.section });
              }
            }
          } catch (e) {
            if (e.name === 'AbortError' || !active()) break;
            console.warn(`[UmSpec] Failed item ${item.name}:`, e);
            // Never hang the pipeline: preserve link in markdown
            externalLinks.push({
              title: `${item.name} (Download skipped: ${e.message || 'network restriction'})`,
              url: item.url,
              section: item.section
            });
          }
        }

        if (!active()) break;

        // Save external links markdown into both Lecture Slides and Recordings folders
        if (externalLinks.length > 0) {
          let linksMd = `# ${globalThis.UmSpecMaterials.markdownText(course.fullName)} - Lecture & Video Links\n\n`;
          linksMd += `> Captured by UmSpec Smart Exporter on ${new Date().toLocaleString()}\n\n`;
          let curSec = null;
          let rejectedLinks = 0;
          externalLinks.forEach(el => {
            let link;
            try { link = globalThis.UmSpecMaterials.markdownLink(el.title, el.url); }
            catch { rejectedLinks++; return; }
            if (el.section !== curSec) {
              curSec = el.section;
              linksMd += `\n### ${globalThis.UmSpecMaterials.markdownText(curSec || 'General')}\n\n`;
            }
            linksMd += `- ${link}\n`;
          });
          if (rejectedLinks) linksMd += `\n> ${rejectedLinks} unsafe link(s) omitted.\n`;
          zip.file(`${course.folderName}/1.Lecture Slide/Lecture_Videos_and_Links.md`, linksMd);
          zip.file(`${course.folderName}/7.Recordings & Media/Lecture_Videos_and_Links.md`, linksMd);
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

      if (!active()) {
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
* **Video Optimization:** ${skipVideos ? 'Links Indexed (Fast)' : 'Full Media Download'}

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
          if (!active()) return;
          percentEl.innerText = `${Math.round(meta.percent)}%`;
          fillEl.style.width = `${meta.percent}%`;
          statusEl.innerText = `Compressing: ${Math.round(meta.percent)}% done...`;
        }
      );

      if (!active()) return;

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
      if (err.name === 'AbortError' || !active()) {
        console.log('[UmSpec] Export was aborted by user');
        return;
      }
      console.error('[UmSpec] Smart export error:', err);
      runnerInstance?.stop('ABORTED');
      statusEl.innerText = `ERROR // ${err.message}`;
      alert(`Smart export failed: ${err.message}`);
    } finally {
      if (runId === exportRunId) {
        isExporting = false;
        abortController = null;
        window.onbeforeunload = null;
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (backBtn) backBtn.disabled = false;
        startBtn.disabled = false;
      }
    }
  }

  function syncUserId(doc) {
    if (!doc) return null;
    const profile = doc.querySelector([
      '.usermenu a[href*="/user/profile.php"]',
      '.usermenu a[href*="/user/view.php"]',
      '[data-region="usermenu"] a[href*="/user/profile.php"]',
      '#user-action-menu a[href*="/user/profile.php"]',
      '.userbutton a[href*="/user/profile.php"]',
      'a[href*="/user/profile.php?id="]',
      'a[href*="/user/view.php?id="]'
    ].join(', '));
    const href = profile?.getAttribute('href');
    const match = href?.match(/[?&]id=(\d+)/);
    if (match && /^[1-9]\d*$/.test(match[1])) return match[1];
    const userId = href && new URL(href, location.origin).searchParams.get('id');
    if (/^[1-9]\d*$/.test(userId || '')) return userId;
    if (doc === document && typeof window !== 'undefined' && window.M?.cfg?.userId) {
      const mId = String(window.M.cfg.userId);
      if (/^[1-9]\d*$/.test(mId)) return mId;
    }
    return null;
  }
  function getSyncContext() {
    if (location.origin !== 'https://spectrum.um.edu.my' || /\/login[/.]/.test(location.pathname) || !getSesskey()) return null;
    const userId = syncUserId(document);
    return userId ? { userId, origin: location.origin } : null;
  }
  async function verifySyncContext() {
    const current = getSyncContext();
    if (!current) throw Object.assign(new Error('Sign in to Spectrum again.'), { code: 'LOGIN_REQUIRED' });
    try {
      const response = await fetchWithTimeout(location.origin + '/my/', {
        credentials: 'include', cache: 'no-store', redirect: 'follow'
      }, 20000);
      if (response.ok && new URL(response.url).origin === location.origin) {
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const remoteId = syncUserId(doc);
        if (remoteId && remoteId !== current.userId) {
          throw Object.assign(new Error('Spectrum account changed. Refresh this tab before syncing.'), { code: 'ACCOUNT_CHANGED' });
        }
      }
    } catch (e) {
      if (e.code === 'ACCOUNT_CHANGED') throw e;
    }
    return current;
  }
  async function resolveCourseMaterials(course, selectedUrls, signal) {
    const parsed = await fetchAndParseCourseItems(course.id, signal);
    const materials = [];
    for (const item of parsed.items) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (selectedUrls && !selectedUrls.has(item.url)) continue;
      const files = item.isVideo && videoDownloadPreference !== 'include'
        ? [{ url: item.url, name: item.name, kind: 'link' }]
        : await globalThis.UmSpecMaterials.resolveItemFiles(item, signal, videoDownloadPreference === 'include' ? 'include' : 'links');
      for (const file of files) materials.push(await globalThis.UmSpecMaterials.describeMaterial(course, item, file, ''));
    }
    return [...new Map(materials.map(item => [item.sourceKey, item])).values()];
  }
  globalThis.UmSpecExporter = {
    getContext: getSyncContext, verifyContext: verifySyncContext, getSesskey, generateDeadlinesICS, resolveCourseMaterials,
    discoverCourses: async () => {
      detectedCourses = await discoverCourses();
      return detectedCourses;
    },
    selectedCourses: () => detectedCourses.filter(c => selectedCourseIds.has(c.id)),
    selectedUrls: courseId => courseItemsSelected.get(Number(courseId)) || null,
    videoPolicy: () => videoDownloadPreference === 'include' ? 'include' : 'links',
    applySettings(settings) {
      videoDownloadPreference = settings.videoPolicy === 'include' ? 'include' : 'skip';
      localStorage.setItem('umspec_video_pref', videoDownloadPreference);
      destinationMode = settings.mode === 'drive' ? 'drive' : 'zip';
      updateSelectionUI();
    },
    showTab: showModalTab,
    setSelectedCourses(ids) { selectedCourseIds = new Set(ids.map(Number)); if (document.getElementById('umspec-course-count')) renderCoursesList(); },
    exportZip: () => runZeroTouchExport({ skipVideos: videoDownloadPreference !== 'include' }),
    openModal,
    fetchCourse: async (courseId, signal) => {
      const response = await fetchWithTimeout('https://spectrum.um.edu.my/course/view.php?id=' + courseId, { credentials: 'include', signal }, 25000);
      if (!response.ok || new URL(response.url).origin !== location.origin || /\/login[/.]/.test(new URL(response.url).pathname)) throw new Error('Sign in to Spectrum again.');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (doc.querySelector('form#login, input[name="password"]')) throw new Error('Spectrum session expired.');
      return doc;
    }
  };
  // Inject UI on SPeCTRUM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTriggerButton);
  } else {
    injectTriggerButton();
  }

})();
