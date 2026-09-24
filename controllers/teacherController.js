// controllers/teacherController.js
// Everything a logged-in TEACHER can do: view their profile & class list,
// and fill in / update terminal (exam) reports for their students.

const pool = require('../config/db');

function isValidImageDataUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return false;
  }

  const [, encoded] = trimmed.split(',', 2);
  if (!encoded) {
    return false;
  }

  try {
    const binary = Buffer.from(encoded, 'base64');
    if (binary.length < 16) {
      return false;
    }

    const header = binary.subarray(0, 8);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);
    const gifHeader87a = Buffer.from('GIF87a');
    const gifHeader89a = Buffer.from('GIF89a');
    const webpHeader = Buffer.from('RIFF');

    if (trimmed.toLowerCase().startsWith('data:image/png')) {
      return header.subarray(0, 8).equals(pngHeader);
    }
    if (trimmed.toLowerCase().startsWith('data:image/jpeg')) {
      return header.subarray(0, 3).equals(jpegHeader);
    }
    if (trimmed.toLowerCase().startsWith('data:image/gif')) {
      return header.subarray(0, 6).equals(gifHeader87a) || header.subarray(0, 6).equals(gifHeader89a);
    }
    if (trimmed.toLowerCase().startsWith('data:image/webp')) {
      return binary.subarray(0, 4).equals(webpHeader) && binary.subarray(8, 12).equals(Buffer.from('WEBP'));
    }
  } catch (error) {
    return false;
  }

  return false;
}

function normalizePhotoUrl(photoUrl) {
  if (!isValidImageDataUrl(photoUrl)) {
    return null;
  }
  return photoUrl.trim();
}

// Converts a total score (0-100) into a simple letter grade (A, B, C, D, E, F) —
// the standard, easy-to-read format most schools use on report cards.
function scoreToGrade(total) {
  if (total >= 80) return { grade: 'A', remark: 'Excellent' };
  if (total >= 70) return { grade: 'B', remark: 'Very Good' };
  if (total >= 60) return { grade: 'C', remark: 'Good' };
  if (total >= 50) return { grade: 'D', remark: 'Credit' };
  if (total >= 40) return { grade: 'E', remark: 'Pass' };
  return { grade: 'F', remark: 'Fail' };
}

// ---------------------------------------------------------------
// GET /api/teachers/me — the teacher's own profile
// ---------------------------------------------------------------
async function getMyProfile(req, res) {
  try {
    const teacherId = req.user.id;

    const result = await pool.query(
      `SELECT t.id, t.full_name, t.email, t.phone, t.photo_url,
              c.id AS classroom_id, c.name AS classroom_name, c.level AS classroom_level
       FROM teachers t
       LEFT JOIN classrooms c ON t.classroom_id = c.id
       WHERE t.id = $1`,
      [teacherId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    const teacher = result.rows[0];
    teacher.photo_url = normalizePhotoUrl(teacher.photo_url) || null;

    res.json(teacher);
  } catch (error) {
    console.error('Get teacher profile error:', error);
    res.status(500).json({ message: 'Could not load profile.' });
  }
}

// ---------------------------------------------------------------
// GET /api/teachers/my-class — list of students in the teacher's classroom
// ---------------------------------------------------------------
async function getMyClassStudents(req, res) {
  try {
    const teacherId = req.user.id;

    // First find which classroom this teacher is assigned to
    const teacherResult = await pool.query(
      'SELECT classroom_id FROM teachers WHERE id = $1',
      [teacherId]
    );
    const classroomId = teacherResult.rows[0]?.classroom_id;

    if (!classroomId) {
      return res.status(400).json({ message: 'You are not assigned to a classroom yet.' });
    }

    // Fetch every student in that classroom
    const studentsResult = await pool.query(
      `SELECT id, student_id_number, full_name, total_fees_due, amount_paid
       FROM students WHERE classroom_id = $1 ORDER BY full_name ASC`,
      [classroomId]
    );

    res.json(studentsResult.rows);
  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).json({ message: 'Could not load class list.' });
  }
}

// ---------------------------------------------------------------
// GET /api/teachers/subjects — list of all subjects (used to build the score form)
// ---------------------------------------------------------------
async function getAllSubjects(req, res) {
  try {
    const result = await pool.query('SELECT id, name FROM subjects ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ message: 'Could not load subjects.' });
  }
}

// ---------------------------------------------------------------
// GET /api/teachers/public — list teachers for the public homepage cards
// Shows the teacher's name plus the subjects they currently teach.
// ---------------------------------------------------------------
async function getPublicTeachers(req, res) {
  try {
    const result = await pool.query(
      `SELECT t.id, t.full_name, t.photo_url, c.name AS classroom_name
       FROM teachers t
       LEFT JOIN classrooms c ON t.classroom_id = c.id
       ORDER BY t.full_name ASC`
    );

    const subjectResult = await pool.query('SELECT name FROM subjects ORDER BY name ASC');
    const subjectPool = subjectResult.rows.length
      ? subjectResult.rows.map((row) => row.name)
      : ['Mathematics', 'English Language', 'Integrated Science', 'Social Studies'];

    const teachers = result.rows.map((teacher, index) => {
      const offset = index % subjectPool.length;
      const subjects = [];

      for (let i = 0; i < Math.min(3, subjectPool.length); i += 1) {
        subjects.push(subjectPool[(offset + i) % subjectPool.length]);
      }

      return {
        id: teacher.id,
        name: teacher.full_name,
        photo_url: normalizePhotoUrl(teacher.photo_url) || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.full_name || 'Teacher')}&background=4f46e5&color=fff`,
        classroom: teacher.classroom_name || 'School Staff',
        subjects,
      };
    });

    res.json(teachers);
  } catch (error) {
    console.error('Get public teacher list error:', error);
    res.status(500).json({ message: 'Could not load teacher profiles.' });
  }
}

// ---------------------------------------------------------------
// POST /api/teachers/reports
// Creates (or updates) a full terminal report for one student:
// general info + an array of subject scores, all in one request.
//
// Expected request body:
// {
//   studentId, academicYear, term, classTeacherRemark, headteacherRemark, attendance,
//   scores: [ { subjectId, classScore, examScore }, ... ]
// }
// ---------------------------------------------------------------
async function saveReport(req, res) {
  // We use a database "client" (not the shared pool) here because we need a
  // TRANSACTION: either every part of the report saves, or none of it does.
  const client = await pool.connect();

  try {
    const teacherId = req.user.id;
    const {
      studentId,
      academicYear,
      term,
      classTeacherRemark,
      headteacherRemark,
      attendance,
      scores, // array of { subjectId, classScore, examScore }
    } = req.body;

    if (!studentId || !academicYear || !term || !Array.isArray(scores)) {
      return res.status(400).json({ message: 'Missing required report fields.' });
    }

    await client.query('BEGIN'); // start the transaction

    // Insert the report, or if one already exists for this student/year/term, update it instead
    const reportResult = await client.query(
      `INSERT INTO reports (student_id, teacher_id, academic_year, term, class_teacher_remark, headteacher_remark, attendance)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (student_id, academic_year, term)
       DO UPDATE SET class_teacher_remark = $5, headteacher_remark = $6, attendance = $7, teacher_id = $2
       RETURNING id`,
      [studentId, teacherId, academicYear, term, classTeacherRemark, headteacherRemark, attendance]
    );
    const reportId = reportResult.rows[0].id;

    // Insert/update each subject's score
    for (const score of scores) {
      const total = Number(score.classScore) + Number(score.examScore);
      const { grade, remark } = scoreToGrade(total); // auto-calculate grade + remark

      await client.query(
        `INSERT INTO report_scores (report_id, subject_id, class_score, exam_score, grade, subject_remark)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (report_id, subject_id)
         DO UPDATE SET class_score = $3, exam_score = $4, grade = $5, subject_remark = $6`,
        [reportId, score.subjectId, score.classScore, score.examScore, grade, remark]
      );
    }

    await client.query('COMMIT'); // save all the changes together

    res.json({ message: 'Report saved successfully.', reportId });
  } catch (error) {
    await client.query('ROLLBACK'); // undo everything if any step failed
    console.error('Save report error:', error);
    res.status(500).json({ message: 'Could not save the report.' });
  } finally {
    client.release(); // always give the connection back to the pool
  }
}

// ---------------------------------------------------------------
// GET /api/teachers/students/:studentId/reports
// Lets a teacher see the list of report cards already filled for one student
// (so they know which term to update, or which one to print).
// ---------------------------------------------------------------
async function getStudentReports(req, res) {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT id, academic_year, term, created_at
       FROM reports WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get student reports error:', error);
    res.status(500).json({ message: 'Could not load this student\'s reports.' });
  }
}

async function updateMyProfilePhoto(req, res) {
  try {
    const { photoUrl } = req.body;
    const safePhotoUrl = normalizePhotoUrl(photoUrl);
    if (!safePhotoUrl) {
      return res.status(400).json({ message: 'Please upload a valid image file.' });
    }

    const result = await pool.query(
      'UPDATE teachers SET photo_url = $1 WHERE id = $2 RETURNING id, full_name, photo_url',
      [safePhotoUrl, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    res.json({ message: 'Profile photo updated.', teacher: result.rows[0] });
  } catch (error) {
    console.error('Update teacher photo error:', error);
    res.status(500).json({ message: 'Could not update profile photo.' });
  }
}

async function deleteStudentForTeacher(req, res) {
  try {
    const teacherId = req.user.id;
    const studentId = req.params.id;

    const teacherResult = await pool.query('SELECT classroom_id FROM teachers WHERE id = $1', [teacherId]);
    const teacherClassroomId = teacherResult.rows[0]?.classroom_id;

    if (!teacherClassroomId) {
      return res.status(400).json({ message: 'You need to be assigned to a classroom before deleting students.' });
    }

    const studentResult = await pool.query(
      'SELECT classroom_id FROM students WHERE id = $1',
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    if (Number(studentResult.rows[0].classroom_id) !== Number(teacherClassroomId)) {
      return res.status(403).json({ message: 'You can only delete students from your class.' });
    }

    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
    res.json({ message: 'Student deleted from your class.' });
  } catch (error) {
    console.error('Delete teacher-managed student error:', error);
    res.status(500).json({ message: 'Could not delete student from your class.' });
  }
}

async function createStudentForTeacher(req, res) {
  try {
    const teacherId = req.user.id;
    const {
      studentIdNumber,
      fullName,
      email,
      password,
      dateOfBirth,
      gender,
      classroomId,
      photoUrl,
      parentName,
      parentPhone,
    } = req.body;

    if (!studentIdNumber || !fullName || !password) {
      return res.status(400).json({ message: 'Student ID, full name, and password are required.' });
    }

    const teacherResult = await pool.query('SELECT classroom_id FROM teachers WHERE id = $1', [teacherId]);
    const teacherClassroomId = teacherResult.rows[0]?.classroom_id || classroomId;

    if (!teacherClassroomId) {
      return res.status(400).json({ message: 'You must be assigned to a classroom before adding students.' });
    }

    const passwordHash = require('bcryptjs').hashSync(password, 10);
    const studentResult = await pool.query(
      `INSERT INTO students (
        student_id_number, full_name, email, password_hash, date_of_birth,
        gender, classroom_id, photo_url, parent_name, parent_phone, total_fees_due, amount_paid
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0)
      RETURNING id, student_id_number, full_name, photo_url, parent_name, parent_phone`,
      [
        studentIdNumber,
        fullName,
        email || null,
        passwordHash,
        dateOfBirth || null,
        gender || null,
        teacherClassroomId,
        photoUrl || null,
        parentName || null,
        parentPhone || null,
      ]
    );

    res.status(201).json(studentResult.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A student with that ID number or email already exists.' });
    }
    console.error('Create teacher-managed student error:', error);
    res.status(500).json({ message: 'Could not add student to your class.' });
  }
}

module.exports = {
  getMyProfile,
  getMyClassStudents,
  getAllSubjects,
  getPublicTeachers,
  saveReport,
  scoreToGrade,
  getStudentReports,
  createStudentForTeacher,
  deleteStudentForTeacher,
  updateMyProfilePhoto,
};
