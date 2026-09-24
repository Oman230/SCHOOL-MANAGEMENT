-- ============================================================
-- SCHOOL MANAGEMENT SYSTEM — DATABASE SCHEMA (PostgreSQL)
-- Run this once against your database, e.g.:
--   psql -U postgres -d school_system -f database/schema.sql
-- ============================================================

-- Drop old tables first (safe to run repeatedly while developing)
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS report_scores CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS teachers CASCADE;
DROP TABLE IF EXISTS classrooms CASCADE;
DROP TABLE IF EXISTS admins CASCADE;

-- ------------------------------------------------------------
-- ADMINS — school administrators who manage teachers, students, and classrooms
-- ------------------------------------------------------------
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,                 -- unique admin id
    full_name VARCHAR(100) NOT NULL,       -- admin's full name
    email VARCHAR(100) UNIQUE NOT NULL,    -- used to log in
    password_hash VARCHAR(255) NOT NULL,   -- bcrypt-hashed password
    created_at TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- CLASSROOMS (e.g. "Basic 6A", "JHS 2B")
-- ------------------------------------------------------------
CREATE TABLE classrooms (
    id SERIAL PRIMARY KEY,              -- unique classroom id
    name VARCHAR(50) NOT NULL,          -- e.g. "JHS 2B"
    level VARCHAR(50) NOT NULL,         -- e.g. "Junior High School 2"
    created_at TIMESTAMP DEFAULT NOW()  -- when the classroom was created
);

-- ------------------------------------------------------------
-- TEACHERS
-- ------------------------------------------------------------
CREATE TABLE teachers (
    id SERIAL PRIMARY KEY,                       -- unique teacher id
    full_name VARCHAR(100) NOT NULL,             -- teacher's full name
    email VARCHAR(100) UNIQUE NOT NULL,          -- used to log in
    password_hash VARCHAR(255) NOT NULL,         -- bcrypt-hashed password (never store plain text)
    phone VARCHAR(20),                           -- contact number
    classroom_id INTEGER REFERENCES classrooms(id), -- classroom the teacher is in charge of (optional)
    photo_url TEXT,                              -- passport-size profile picture (optional)
    created_at TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- STUDENTS
-- ------------------------------------------------------------
CREATE TABLE students (
    id SERIAL PRIMARY KEY,                       -- unique student id
    student_id_number VARCHAR(30) UNIQUE NOT NULL, -- school-issued ID / admission number (used to log in)
    full_name VARCHAR(100) NOT NULL,             -- student's full name
    email VARCHAR(100) UNIQUE,                   -- optional, for notifications
    password_hash VARCHAR(255) NOT NULL,         -- bcrypt-hashed password
    date_of_birth DATE,                          -- student's date of birth
    gender VARCHAR(10),                          -- Male / Female
    classroom_id INTEGER REFERENCES classrooms(id), -- which class the student belongs to
    photo_url TEXT,                              -- profile picture path (optional)
    parent_name VARCHAR(100),                    -- parent/guardian name
    parent_phone VARCHAR(20),                    -- parent/guardian phone number

    -- fee tracking fields
    total_fees_due NUMERIC(10,2) DEFAULT 0,      -- the total fee amount owed for the term
    amount_paid NUMERIC(10,2) DEFAULT 0,         -- running total the student has paid so far

    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);
ALTER TABLE teachers ALTER COLUMN photo_url TYPE TEXT;
ALTER TABLE students ALTER COLUMN photo_url TYPE TEXT;

-- ------------------------------------------------------------
-- SUBJECTS (e.g. Mathematics, English, Science)
-- ------------------------------------------------------------
CREATE TABLE subjects (
    id SERIAL PRIMARY KEY,               -- unique subject id
    name VARCHAR(100) NOT NULL UNIQUE    -- e.g. "Mathematics"
);

-- ------------------------------------------------------------
-- ANNOUNCEMENTS — daily updates for school activity and parent notices
-- ------------------------------------------------------------
CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- REPORTS — one row per student, per term, per academic year
-- (holds the overall report card; individual subject scores live in report_scores)
-- ------------------------------------------------------------
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,                          -- unique report id
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, -- which student this report belongs to
    teacher_id INTEGER REFERENCES teachers(id),     -- teacher who filled the report
    academic_year VARCHAR(20) NOT NULL,             -- e.g. "2025/2026"
    term VARCHAR(20) NOT NULL,                      -- "First Term" / "Second Term" / "Third Term"
    class_teacher_remark TEXT,                      -- class teacher's remark
    headteacher_remark TEXT,                        -- head teacher's remark
    attendance VARCHAR(20),                         -- e.g. "58/60"
    promoted_to VARCHAR(50),                        -- next class the student is promoted to (optional)
    created_at TIMESTAMP DEFAULT NOW(),             -- when the report was first created
    UNIQUE (student_id, academic_year, term)        -- prevents duplicate reports for same term
);

-- ------------------------------------------------------------
-- REPORT_SCORES — each subject's marks for a given report
-- Ghana Education Service terminal reports typically combine:
-- class score (continuous assessment) + exam score = total score
-- ------------------------------------------------------------
CREATE TABLE report_scores (
    id SERIAL PRIMARY KEY,                                 -- unique row id
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE, -- which report this score belongs to
    subject_id INTEGER REFERENCES subjects(id),            -- which subject
    class_score NUMERIC(5,2) DEFAULT 0,                    -- continuous assessment score (usually out of 50)
    exam_score NUMERIC(5,2) DEFAULT 0,                     -- end of term exam score (usually out of 50)
    total_score NUMERIC(5,2) GENERATED ALWAYS AS (class_score + exam_score) STORED, -- auto-calculated total
    grade VARCHAR(5),                                      -- e.g. "A1", "B2" (filled in by the app)
    subject_remark VARCHAR(50),                            -- e.g. "Excellent", "Good", "Needs Improvement"
    position_in_subject INTEGER,                           -- student's rank in this subject (optional)
    UNIQUE (report_id, subject_id)                         -- one score per subject per report
);

-- ------------------------------------------------------------
-- PAYMENTS — every Paystack transaction is logged here
-- ------------------------------------------------------------
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,                          -- unique payment id
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, -- who paid
    amount NUMERIC(10,2) NOT NULL,                  -- amount paid (in GHS)
    paystack_reference VARCHAR(100) UNIQUE NOT NULL,-- Paystack's unique transaction reference
    status VARCHAR(20) DEFAULT 'pending',           -- pending / success / failed
    paid_at TIMESTAMP DEFAULT NOW()                 -- when the payment was recorded
);

-- ------------------------------------------------------------
-- Seed a couple of default classrooms and subjects so the app has data to work with
-- ------------------------------------------------------------
INSERT INTO classrooms (name, level) VALUES
    ('JHS 1A', 'Junior High School 1'),
    ('JHS 2A', 'Junior High School 2'),
    ('JHS 3A', 'Junior High School 3');

INSERT INTO subjects (name) VALUES
    ('Mathematics'),
    ('English Language'),
    ('Integrated Science'),
    ('Social Studies'),
    ('Religious and Moral Education'),
    ('Information and Communication Technology'),
    ('Ghanaian Language'),
    ('French');
