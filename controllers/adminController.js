// controllers/adminController.js
// Everything a logged-in ADMIN can do: see overview stats, and create/view/
// edit/delete classrooms, teachers, and students — this is what replaces
// having to run raw SQL to add new people to the system.

const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// ---------------------------------------------------------------
// GET /api/admin/stats — quick numbers for the top of the admin dashboard
// ---------------------------------------------------------------
async function getStats(req, res) {
  try {
    // Run all the count queries at the same time instead of one after another
    const [studentCount, teacherCount, classroomCount, feesResult] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM students'),
      pool.query('SELECT COUNT(*) FROM teachers'),
      pool.query('SELECT COUNT(*) FROM classrooms'),
      pool.query('SELECT COALESCE(SUM(amount_paid), 0) AS total_paid, COALESCE(SUM(total_fees_due), 0) AS total_due FROM students'),
    ]);

    res.json({
      totalStudents: Number(studentCount.rows[0].count),
      totalTeachers: Number(teacherCount.rows[0].count),
      totalClassrooms: Number(classroomCount.rows[0].count),
      totalFeesCollected: Number(feesResult.rows[0].total_paid),
      totalFeesExpected: Number(feesResult.rows[0].total_due),
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ message: 'Could not load dashboard stats.' });
  }
}

// =================================================================
// CLASSROOMS
// =================================================================

async function getClassrooms(req, res) {
  try {
    const result = await pool.query('SELECT * FROM classrooms ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get classrooms error:', error);
    res.status(500).json({ message: 'Could not load classrooms.' });
  }
}

async function createClassroom(req, res) {
  try {
    const { name, level } = req.body;
    if (!name || !level) {
      return res.status(400).json({ message: 'Please provide both a class name and level.' });
    }
    const result = await pool.query(
      'INSERT INTO classrooms (name, level) VALUES ($1, $2) RETURNING *',
      [name, level]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create classroom error:', error);
    res.status(500).json({ message: 'Could not create classroom.' });
  }
}

async function deleteClassroom(req, res) {
  try {
    await pool.query('DELETE FROM classrooms WHERE id = $1', [req.params.id]);
    res.json({ message: 'Classroom deleted.' });
  } catch (error) {
    // Deleting will fail if students/teachers still reference this classroom —
    // that's Postgres protecting your data, so we explain it clearly here.
    console.error('Delete classroom error:', error);
    res.status(400).json({ message: 'Could not delete classroom — make sure no students or teachers are still assigned to it.' });
  }
}

// =================================================================
// TEACHERS
// =================================================================

async function getTeachers(req, res) {
  try {
    const result = await pool.query(
      `SELECT t.id, t.full_name, t.email, t.phone, c.name AS classroom_name
       FROM teachers t LEFT JOIN classrooms c ON t.classroom_id = c.id
       ORDER BY t.full_name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ message: 'Could not load teachers.' });
  }
}

async function createTeacher(req, res) {
  try {
    const { fullName, email, password, phone, classroomId } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Full name, email, and password are required.' });
    }

    // Hash the password the admin chose before storing it — never store plain text
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO teachers (full_name, email, password_hash, phone, classroom_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, phone`,
      [fullName, email, passwordHash, phone || null, classroomId || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      // Postgres's "unique violation" error code — this email is already taken
      return res.status(400).json({ message: 'A teacher with that email already exists.' });
    }
    console.error('Create teacher error:', error);
    res.status(500).json({ message: 'Could not create teacher.' });
  }
}

async function updateTeacher(req, res) {
  try {
    const { fullName, phone, classroomId } = req.body;
    await pool.query(
      'UPDATE teachers SET full_name = $1, phone = $2, classroom_id = $3 WHERE id = $4',
      [fullName, phone || null, classroomId || null, req.params.id]
    );
    res.json({ message: 'Teacher updated.' });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ message: 'Could not update teacher.' });
  }
}

async function deleteTeacher(req, res) {
  try {
    await pool.query('DELETE FROM teachers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Teacher deleted.' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ message: 'Could not delete teacher.' });
  }
}

// =================================================================
// STUDENTS
// =================================================================

async function getStudents(req, res) {
  try {
    const result = await pool.query(
      `SELECT s.id, s.student_id_number, s.full_name, s.email, s.gender, s.photo_url,
              s.total_fees_due, s.amount_paid, c.name AS classroom_name
       FROM students s LEFT JOIN classrooms c ON s.classroom_id = c.id
       ORDER BY s.full_name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ message: 'Could not load students.' });
  }
}

async function getStudentReports(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, academic_year, term, created_at
       FROM reports WHERE student_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get student reports error:', error);
    res.status(500).json({ message: 'Could not load this student\'s reports.' });
  }
}

async function createStudent(req, res) {
  try {
    const {
      studentIdNumber, fullName, email, password,
      dateOfBirth, gender, classroomId, totalFeesDue, photoUrl, parentName, parentPhone,
    } = req.body;

    if (!studentIdNumber || !fullName || !password) {
      return res.status(400).json({ message: 'Student ID, full name, and password are required.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO students
        (student_id_number, full_name, email, password_hash, date_of_birth, gender, classroom_id, photo_url, parent_name, parent_phone, total_fees_due, amount_paid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0)
       RETURNING id, student_id_number, full_name, photo_url`,
      [
        studentIdNumber, fullName, email || null, passwordHash,
        dateOfBirth || null, gender || null, classroomId || null, photoUrl || null,
        parentName || null, parentPhone || null, totalFeesDue || 0,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A student with that ID number or email already exists.' });
    }
    console.error('Create student error:', error);
    res.status(500).json({ message: 'Could not create student.' });
  }
}

async function updateStudent(req, res) {
  try {
    const { fullName, classroomId, totalFeesDue, gender, dateOfBirth, photoUrl } = req.body;
    await pool.query(
      `UPDATE students
       SET full_name = $1, classroom_id = $2, total_fees_due = $3, gender = $4, date_of_birth = $5, photo_url = $6
       WHERE id = $7`,
      [fullName, classroomId || null, totalFeesDue, gender || null, dateOfBirth || null, photoUrl || null, req.params.id]
    );
    res.json({ message: 'Student updated.' });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ message: 'Could not update student.' });
  }
}

async function deleteStudent(req, res) {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    res.json({ message: 'Student deleted.' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ message: 'Could not delete student.' });
  }
}

async function getAnnouncements(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, title, message, created_at FROM announcements ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ message: 'Could not load announcements.' });
  }
}

async function getPublicAnnouncements(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, title, message, created_at FROM announcements ORDER BY created_at DESC LIMIT 5'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get public announcements error:', error);
    res.status(500).json({ message: 'Could not load announcements.' });
  }
}

async function createAnnouncement(req, res) {
  try {
    const { title, message } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({ message: 'Title and message are required.' });
    }

    const result = await pool.query(
      'INSERT INTO announcements (title, message) VALUES ($1, $2) RETURNING *',
      [title.trim(), message.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ message: 'Could not create announcement.' });
  }
}

async function updateAnnouncement(req, res) {
  try {
    const { title, message } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({ message: 'Title and message are required.' });
    }

    const result = await pool.query(
      'UPDATE announcements SET title = $1, message = $2 WHERE id = $3 RETURNING *',
      [title.trim(), message.trim(), req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Announcement not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ message: 'Could not update announcement.' });
  }
}

async function deleteAnnouncement(req, res) {
  try {
    const result = await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Announcement not found.' });
    }
    res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ message: 'Could not delete announcement.' });
  }
}

async function getSubjects(req, res) {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ message: 'Could not load subjects.' });
  }
}

async function createSubject(req, res) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Subject name is required.' });
    }

    const result = await pool.query(
      'INSERT INTO subjects (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A subject with that name already exists.' });
    }
    console.error('Create subject error:', error);
    res.status(500).json({ message: 'Could not create subject.' });
  }
}

async function updateSubject(req, res) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Subject name is required.' });
    }

    const result = await pool.query(
      'UPDATE subjects SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Subject not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A subject with that name already exists.' });
    }
    console.error('Update subject error:', error);
    res.status(500).json({ message: 'Could not update subject.' });
  }
}

async function deleteSubject(req, res) {
  try {
    await pool.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
    res.json({ message: 'Subject deleted.' });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(400).json({ message: 'Could not delete this subject because it is linked to report data.' });
  }
}

module.exports = {
  getStats,
  getClassrooms, createClassroom, deleteClassroom,
  getTeachers, createTeacher, updateTeacher, deleteTeacher,
  getStudents, getStudentReports, createStudent, updateStudent, deleteStudent,
  getAnnouncements, getPublicAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  getSubjects, createSubject, updateSubject, deleteSubject,
};
