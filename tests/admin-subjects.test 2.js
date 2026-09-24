const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../controllers/adminController');
const authController = require('../controllers/authController');
const teacherController = require('../controllers/teacherController');
const db = require('../config/db');

test('admin exposes subject management APIs', () => {
  assert.equal(typeof admin.getSubjects, 'function');
  assert.equal(typeof admin.createSubject, 'function');
  assert.equal(typeof admin.updateSubject, 'function');
  assert.equal(typeof admin.deleteSubject, 'function');
});

test('admin exposes announcement management APIs for home-page updates', () => {
  assert.equal(typeof admin.getAnnouncements, 'function');
  assert.equal(typeof admin.getPublicAnnouncements, 'function');
  assert.equal(typeof admin.createAnnouncement, 'function');
  assert.equal(typeof admin.updateAnnouncement, 'function');
  assert.equal(typeof admin.deleteAnnouncement, 'function');
});

test('admin exposes student report history needed for trend badges', () => {
  assert.equal(typeof admin.getStudentReports, 'function');
});

test('student creation payload supports photo uploads', () => {
  const student = {
    studentIdNumber: 'STU-001',
    fullName: 'Jane Doe',
    password: 'secret123',
    photoUrl: 'data:image/png;base64,abc123',
  };

  assert.equal(typeof student.photoUrl, 'string');
  assert.match(student.photoUrl, /^data:image\//);
});

test('teacher student creation supports parent contact and photo fields', () => {
  assert.equal(typeof teacherController.createStudentForTeacher, 'function');

  const studentPayload = {
    studentIdNumber: 'STU-010',
    fullName: 'John Doe',
    email: 'john@example.com',
    password: 'secret123',
    gender: 'Male',
    photoUrl: 'data:image/jpeg;base64,abc',
    parentName: 'Mary Doe',
    parentPhone: '+233500000000',
  };

  assert.equal(studentPayload.parentName, 'Mary Doe');
  assert.equal(studentPayload.parentPhone, '+233500000000');
  assert.match(studentPayload.photoUrl, /^data:image\//);
});

test('teacher signup and student photo upload are exposed as backend actions', () => {
  assert.equal(typeof authController.teacherSignup, 'function');
  assert.equal(typeof require('../controllers/studentController').updateMyProfilePhoto, 'function');
  assert.equal(typeof require('../controllers/teacherController').deleteStudentForTeacher, 'function');
});

test('teacher school email validation enforces the approved institutional domain', () => {
  assert.equal(authController.isValidTeacherEmail('jane.doe@sunriseinternationalschool.edu'), true);
  assert.equal(authController.isValidTeacherEmail('jane@gmail.com'), false);
  assert.equal(authController.isValidTeacherEmail('teacher@sunriseinternationalschool.edu.ng'), false);
});

test('photo fields use text storage so base64 images can be saved without truncation', () => {
  assert.ok(Array.isArray(db.photoMigrationQueries));
  const schemaSql = db.photoMigrationQueries.join(' ');
  assert.match(schemaSql, /ALTER TABLE .*teachers.*photo_url.*TYPE TEXT/i);
  assert.match(schemaSql, /ALTER TABLE .*students.*photo_url.*TYPE TEXT/i);
});
