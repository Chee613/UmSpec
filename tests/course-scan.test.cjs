const test = require('node:test');
const assert = require('node:assert/strict');
const scan = require('../shared/course-scan.js');

// Titles and sections below are real names from a Spectrum account (Nov 2026).
test('file types match whole words, so "example" is not an exam and "syllabus" is not a lab', () => {
  const type = (title, section = '', ext = '') => scan.classifyAdaptiveCategory(title, section, ext).id;
  assert.equal(type('example file system (W1)', 'Week 1 : Introduction to the Database'), 'Lecture Slides');
  assert.equal(type('Normalization Exercise 2', 'Week 4 : Normalization'), 'Tutorials');
  assert.equal(type('UM-PT01-MQF-BR006-S00 MAKLUMAT KURSUS', 'General'), 'Course Info');
  assert.equal(type('Syllabus'), 'Course Info');
  assert.equal(type('Peer Work Group Evaluation Forms', 'GROUP PROJECT (30%)'), 'Assignments & Projects');
  assert.equal(type('Tutorial 3 (2026.2027)', 'Week 4 : Normalization'), 'Tutorials');
  assert.equal(type('Lab 2 worksheet', 'Week 2'), 'Labs');
  assert.equal(type('Mid Term Test on 19th Nov'), 'Past Year & Tests');
  assert.equal(type('Latest updates', 'Week 3'), 'Lecture Slides');
  assert.equal(type('Week 1 files', 'General', '.php'), 'Lecture Slides', 'every activity address ends in view.php');
  assert.equal(type('lesson', '', '.mp4'), 'Recordings & Media');
  assert.equal(type('starter', '', '.py'), 'Source Code');
});

test('Drive names use the Spectrum title with a week prefix and keep the file extension', () => {
  assert.equal(scan.displayName({ title: 'Normalization - Compact Notes', section: 'Week 4 : Normalization', fileName: 'Normalization_modern (1).pptx' }), 'W04 Normalization - Compact Notes.pptx');
  assert.equal(scan.displayName({ title: 'Course Proforma', section: 'General', fileName: 'UM-PT01.pdf' }), 'Course Proforma.pdf');
  assert.equal(scan.displayName({ title: 'Tutorial Folder', section: 'Week 2', fileName: 'Q1 answers.pdf', multiple: true }), 'W02 Tutorial Folder - Q1 answers.pdf');
  assert.equal(scan.displayName({ title: 'w7 Listening Skills', section: 'Week 7', fileName: 'Listening Skills.ppt' }), 'w7 Listening Skills.ppt');
  assert.equal(scan.displayName({ title: 'Notes: part 1/2', section: 'WEEK 9 : SQL', fileName: 'SQL.pptx' }), 'W09 Notes part 1 2.pptx');
  assert.equal(scan.displayName({ title: '', section: '', fileName: 'Database Design (1).pptx' }), 'Database Design.pptx');
  assert.equal(scan.weekOf('Minggu 3: Pengenalan'), 3);
  assert.equal(scan.weekOf('GROUP PROJECT (30%)'), null);
});

test('submission, attendance and quiz pages are not counted as course links', () => {
  assert.equal(scan.isMaterialLink('Tutorial 6 Submission Link', 'https://spectrum.um.edu.my/mod/url/view.php?id=1'), false);
  assert.equal(scan.isMaterialLink('Quiz Link (04.11.2026)', 'https://forms.office.com/x'), false);
  assert.equal(scan.isMaterialLink('Lecture Attendance (OCC 8)', 'https://spectrum.um.edu.my/mod/url/view.php?id=2'), false);
  assert.equal(scan.isMaterialLink('Week 3 recording', 'https://spectrum.um.edu.my/mod/assign/view.php?id=3'), false);
  assert.equal(scan.isMaterialLink('Lecture recording', 'https://www.youtube.com/watch?v=x'), true);
  assert.equal(scan.isMaterialLink('Online MS Team link', 'https://teams.microsoft.com/l/x'), true);
  assert.equal(scan.isMaterialLink('TUTORIAL 1 (OCC7)', 'https://spectrum.um.edu.my/course/section.php?id=473720'), false);
});

test('course folders keep three- and four-letter UM course codes', () => {
  assert.equal(scan.formatCourseFolder('WIA2001/WIB2001 DATABASE', 'WIA2001'), 'WIA2001 Database');
  assert.equal(scan.formatCourseFolder('KXEX1110 ENGINEERING MATHEMATICS 1', 'KXEX1110'), 'KXEX1110 Engineering Mathematics 1');
  assert.equal(scan.formatCourseFolder('KIX1001/KXEX1001 ENGINEERING DRAWING', 'KIX1001'), 'KIX1001 Engineering Drawing');
  assert.equal(scan.formatCourseFolder('Turnitin Course Submission', 'TCS00'), 'Turnitin Course Submission');
});

test('courses organised by topic, chapter, bab or lecture still sort in teaching order', () => {
  const name = (title, section) => scan.displayName({ title, section, fileName: title.toLowerCase().replace(/\s+/g, '-') + '.pdf' });
  assert.equal(name('Introduction', 'Topic 3: Probability'), 'T03 Introduction.pdf');
  assert.equal(name('Limits', 'Chapter 2 - Limits'), 'C02 Limits.pdf');
  assert.equal(name('Pengenalan', 'Bab 2 Pengenalan'), 'B02 Pengenalan.pdf');
  assert.equal(name('Handout', 'Kuliah 7'), 'L07 Handout.pdf');
  assert.equal(name('Slides', 'Lecture 5'), 'L05 Slides.pdf');
  assert.equal(name('Topic 3 Intro', 'Topic 3'), 'Topic 3 Intro.pdf', 'a title that already carries its number is not prefixed twice');
  assert.equal(name('Notes', 'Topic 3: Lecture 5 notes'), 'T03 Notes.pdf', 'the first label in the section wins');
  assert.equal(name('Overview', 'General'), 'Overview.pdf');
  assert.equal(name('Tutorial 3', 'Week 4 : Normalization'), 'W04 Tutorial 3.pdf');
  assert.deepEqual(scan.sequenceOf('Modul 4: Etika'), { letter: 'M', number: 4 });
  assert.equal(scan.sequenceOf('GROUP PROJECT (30%)'), null);
});

test('an assignment with one attached file is named after the assignment alone', () => {
  const materials = require('../content/materials.js');
  return Promise.all([1, 2].map(count => materials.describeMaterial({ id: 129, fullName: 'WIA2001 Database', folderName: 'WIA2001 Database' },
    { name: 'TUTORIAL 5 (OCC4)', section: 'Week 6', type: 'assign', url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=5', fileCount: count },
    { url: 'https://spectrum.um.edu.my/pluginfile.php/9/mod_assign/intro/WIA2001%20DATABASE%20TUT5%20ANS.docx', name: 'WIA2001 DATABASE TUT5 ANS.docx', kind: 'binary' }, '')))
    .then(([one, two]) => {
      assert.equal(one.displayName, 'W06 TUTORIAL 5 (OCC4).docx');
      assert.equal(two.displayName, 'W06 TUTORIAL 5 (OCC4) - WIA2001 DATABASE TUT5 ANS.docx');
    });
});

test('a link address pasted as "Join: https://…" is repaired to the https address inside it', () => {
  const { repairLink } = require('../shared/course-scan.js');
  assert.equal(repairLink('join: https://teams.microsoft.com/meet/4832?p=VSr'), 'https://teams.microsoft.com/meet/4832?p=VSr');
  assert.equal(repairLink('join:%20https://teams.microsoft.com/meet/1'), 'https://teams.microsoft.com/meet/1');
  assert.equal(repairLink('https://spectrum.um.edu.my/mod/url/view.php?id=1'), 'https://spectrum.um.edu.my/mod/url/view.php?id=1');
  assert.equal(repairLink('mailto:lecturer@um.edu.my'), 'mailto:lecturer@um.edu.my', 'nothing to repair stays as it was');
});
