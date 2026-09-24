// public/js/admin.js
// Powers the admin dashboard: loading stats, and the create/list/delete
// actions for classrooms, teachers, and students.

const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Redirect to login if not logged in as an admin
if (!token || !user || user.role !== 'admin') {
  window.location.href = '/login.html';
}

// ---------------------- SMALL FETCH HELPERS ----------------------
async function apiGet(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = '/login.html';
  }
  return response.json();
}

async function apiSend(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: response.ok, data: await response.json() };
}

let classroomsCache = []; // reused to fill the classroom dropdowns in the teacher/student forms
let teacherEditId = null;
let studentEditId = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function averageFromScores(scores) {
  if (!Array.isArray(scores) || !scores.length) return 0;
  return scores.reduce((sum, score) => sum + Number(score.total_score || 0), 0) / scores.length;
}

function getTrendMeta(currentAverage, previousAverage) {
  const difference = currentAverage - previousAverage;

  if (!Number.isFinite(currentAverage) || !Number.isFinite(previousAverage) || Math.abs(difference) < 0.01) {
    return { text: 'Steady', tone: 'neutral', icon: '→' };
  }

  if (difference > 0) {
    return { text: `Up ${Math.abs(difference).toFixed(1)}%`, tone: 'up', icon: '↑' };
  }

  return { text: `Down ${Math.abs(difference).toFixed(1)}%`, tone: 'down', icon: '↓' };
}

function buildTrendMarkup(trend) {
  if (!trend) {
    trend = { text: 'No previous report yet', tone: 'neutral', icon: '•' };
  }

  return `
    <span class="trend-pill ${trend.tone}">
      <span class="trend-icon">${trend.icon}</span>
      ${trend.text}
    </span>
  `;
}

async function getStudentTrend(studentId) {
  try {
    const reports = await apiGet(`/api/admin/students/${studentId}/reports`);
    if (!Array.isArray(reports) || reports.length < 2) {
      return buildTrendMarkup({ text: 'No previous report yet', tone: 'neutral', icon: '•' });
    }

    const [latestReport, previousReport] = await Promise.all([
      apiGet(`/api/reports/${reports[0].id}`),
      apiGet(`/api/reports/${reports[1].id}`),
    ]);

    const latestAverage = averageFromScores(latestReport.scores);
    const previousAverage = averageFromScores(previousReport.scores);
    return buildTrendMarkup(getTrendMeta(latestAverage, previousAverage));
  } catch (error) {
    console.error('Failed to load student trend:', error);
    return buildTrendMarkup({ text: 'Trend unavailable', tone: 'neutral', icon: '•' });
  }
}

// ---------------------- OVERVIEW STATS ----------------------
async function loadStats() {
  const stats = await apiGet('/api/admin/stats');
  document.getElementById('welcome-heading').textContent = `Welcome, ${user.name}!`;
  document.getElementById('stat-students').textContent = stats.totalStudents;
  document.getElementById('stat-teachers').textContent = stats.totalTeachers;
  document.getElementById('stat-classrooms').textContent = stats.totalClassrooms;
  document.getElementById('stat-fees').textContent = stats.totalFeesCollected.toFixed(2);
}

// ---------------------- CLASSROOMS ----------------------
async function loadClassrooms() {
  const classrooms = await apiGet('/api/admin/classrooms');
  classroomsCache = classrooms;

  // Fill the classrooms table
  const tbody = document.getElementById('classrooms-table-body');
  tbody.innerHTML = classrooms.length
    ? classrooms
        .map(
          (c) => `
        <tr>
          <td>${c.name}</td>
          <td>${c.level}</td>
          <td><button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);" onclick="deleteClassroom(${c.id})">Delete</button></td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="3">No classrooms yet.</td></tr>';

  // Fill the classroom dropdowns used in the teacher and student "add" forms
  const optionsHtml = classrooms.map((c) => `<option value="${c.id}">${c.name} (${c.level})</option>`).join('');
  document.getElementById('teacherClassroom').innerHTML = '<option value="">Assign classroom (optional)</option>' + optionsHtml;
  document.getElementById('studentClassroom').innerHTML = '<option value="">Assign classroom</option>' + optionsHtml;
}

document.getElementById('classroom-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('classroomName').value.trim();
  const level = document.getElementById('classroomLevel').value.trim();

  const { ok, data } = await apiSend('POST', '/api/admin/classrooms', { name, level });
  if (!ok) return alert(data.message);

  event.target.reset();
  loadClassrooms();
  loadStats();
});

async function deleteClassroom(id) {
  if (!confirm('Delete this classroom? This only works if no students/teachers are assigned to it.')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/classrooms/${id}`);
  if (!ok) return alert(data.message);
  loadClassrooms();
  loadStats();
}

// ---------------------- TEACHERS ----------------------
function resolveClassroomIdByName(classroomName) {
  const trimmedName = (classroomName || '').trim();
  if (!trimmedName) return null;

  const match = classroomsCache.find((room) => room.name.toLowerCase() === trimmedName.toLowerCase());
  return match ? match.id : null;
}

async function editTeacher(teacher) {
  const fullName = prompt('Edit teacher full name:', teacher.full_name || '');
  if (fullName === null) return;

  const phone = prompt('Edit teacher phone number:', teacher.phone || '');
  if (phone === null) return;

  const classroomOptions = classroomsCache.length
    ? classroomsCache.map((room) => room.name).join(', ')
    : 'No classrooms available';
  const classroomName = prompt(`Edit classroom name (${classroomOptions}):`, teacher.classroom_name || '');
  if (classroomName === null) return;

  const classroomId = classroomName.trim() ? resolveClassroomIdByName(classroomName) : null;
  if (classroomName.trim() && !classroomId) {
    return alert('Classroom not found. Please use an exact classroom name from the list shown.');
  }

  const { ok, data } = await apiSend('PUT', `/api/admin/teachers/${teacher.id}`, {
    fullName: fullName.trim(),
    phone: phone.trim(),
    classroomId,
  });

  if (!ok) return alert(data.message);
  loadTeachers();
}

function getClassroomSelectHtml(selectedName = '') {
  const options = classroomsCache.length
    ? classroomsCache
        .map((room) => `<option value="${room.name}" ${room.name === selectedName ? 'selected' : ''}>${room.name}</option>`)
        .join('')
    : '<option value="">No classrooms available</option>';

  return `
    <select class="inline-edit-select" data-role="classroom">${options}</select>
  `;
}

async function loadTeachers() {
  const teachers = await apiGet('/api/admin/teachers');
  const tbody = document.getElementById('teachers-table-body');

  tbody.innerHTML = teachers.length
    ? teachers.map((t) => {
        if (teacherEditId === t.id) {
          return `
            <tr class="inline-edit-row">
              <td><input class="inline-edit-input" type="text" value="${escapeHtml(t.full_name)}" data-field="fullName" /></td>
              <td>${escapeHtml(t.email)}</td>
              <td>${getClassroomSelectHtml(t.classroom_name || '')}</td>
              <td>
                <div class="inline-edit-actions">
                  <button class="btn btn-primary" type="button" data-action="save-teacher" data-id="${t.id}">Save</button>
                  <button class="btn btn-outline" type="button" data-action="cancel-teacher" data-id="${t.id}" style="margin-left:8px;">Cancel</button>
                </div>
              </td>
            </tr>`;
        }

        return `
          <tr>
            <td>${escapeHtml(t.full_name)}</td>
            <td>${escapeHtml(t.email)}</td>
            <td>${escapeHtml(t.classroom_name || '-')}</td>
            <td>
              <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" data-action="edit-teacher" data-id="${t.id}">Edit</button>
              <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteTeacher(${t.id})">Delete</button>
            </td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="4">No teachers yet.</td></tr>';
}

document.getElementById('teachers-table-body').addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const teacherId = Number(target.dataset.id);

  if (action === 'edit-teacher') {
    teacherEditId = teacherId;
    loadTeachers();
    return;
  }

  if (action === 'cancel-teacher') {
    teacherEditId = null;
    loadTeachers();
    return;
  }

  if (action === 'save-teacher') {
    const row = target.closest('tr');
    const fullName = row.querySelector('[data-field="fullName"]').value.trim();
    const classroomName = row.querySelector('[data-role="classroom"]').value;
    const phoneInput = row.querySelector('[data-field="phone"]');
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!fullName) {
      return alert('Teacher name cannot be empty.');
    }

    const classroomId = classroomName ? resolveClassroomIdByName(classroomName) : null;
    if (classroomName && !classroomId) {
      return alert('Classroom not found. Please choose a valid classroom.');
    }

    const { ok, data } = await apiSend('PUT', `/api/admin/teachers/${teacherId}`, {
      fullName,
      phone,
      classroomId,
    });

    if (!ok) return alert(data.message);
    teacherEditId = null;
    loadTeachers();
  }
});

document.getElementById('teacher-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    fullName: document.getElementById('teacherFullName').value.trim(),
    email: document.getElementById('teacherEmail').value.trim(),
    password: document.getElementById('teacherPassword').value,
    phone: document.getElementById('teacherPhone').value.trim(),
    classroomId: document.getElementById('teacherClassroom').value || null,
  };

  const { ok, data } = await apiSend('POST', '/api/admin/teachers', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadTeachers();
  loadStats();
});

async function deleteTeacher(id) {
  if (!confirm('Delete this teacher account?')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/teachers/${id}`);
  if (!ok) return alert(data.message);
  loadTeachers();
  loadStats();
}

// ---------------------- STUDENTS ----------------------
async function renderStudentMomentumOverview(students) {
  const panel = document.getElementById('admin-momentum-panel');
  if (!panel) return;

  if (!students.length) {
    panel.innerHTML = '<div class="mini-momentum-item"><small>Student momentum</small><strong>No students yet</strong></div>';
    return;
  }

  const summaries = await Promise.all(students.map(async (student) => {
    try {
      const reports = await apiGet(`/api/admin/students/${student.id}/reports`);
      if (!Array.isArray(reports) || reports.length < 2) {
        return { student, change: 0, trend: { text: 'No previous report yet', tone: 'neutral', icon: '•' } };
      }

      const [latestReport, previousReport] = await Promise.all([
        apiGet(`/api/reports/${reports[0].id}`),
        apiGet(`/api/reports/${reports[1].id}`),
      ]);

      const latestAverage = averageFromScores(latestReport.scores);
      const previousAverage = averageFromScores(previousReport.scores);
      const change = latestAverage - previousAverage;
      return { student, change, trend: getTrendMeta(latestAverage, previousAverage) };
    } catch (error) {
      return { student, change: 0, trend: { text: 'Trend unavailable', tone: 'neutral', icon: '•' } };
    }
  }));

  const topImprover = [...summaries]
    .filter((entry) => entry.change > 0)
    .sort((a, b) => b.change - a.change)[0];

  const biggestDrop = [...summaries]
    .filter((entry) => entry.change < 0)
    .sort((a, b) => a.change - b.change)[0];

  const steadyCount = summaries.filter((entry) => Math.abs(entry.change) < 0.01).length;

  const topCard = topImprover
    ? `<div class="mini-momentum-item item-up"><div class="mini-momentum-header"><span class="mini-momentum-icon">↗</span><small>Top improver</small></div><div class="mini-momentum-row"><strong>${topImprover.student.full_name}</strong>${buildTrendMarkup(topImprover.trend)}</div></div>`
    : '<div class="mini-momentum-item item-up"><div class="mini-momentum-header"><span class="mini-momentum-icon">↗</span><small>Top improver</small></div><div class="mini-momentum-row"><strong>No gains yet</strong><span class="trend-pill neutral"><span class="trend-icon">•</span> No data</span></div></div>';

  const dropCard = biggestDrop
    ? `<div class="mini-momentum-item item-support"><div class="mini-momentum-header"><span class="mini-momentum-icon">⚠</span><small>Needs support</small></div><div class="mini-momentum-row"><strong>${biggestDrop.student.full_name}</strong>${buildTrendMarkup(biggestDrop.trend)}</div></div>`
    : '<div class="mini-momentum-item item-support"><div class="mini-momentum-header"><span class="mini-momentum-icon">⚠</span><small>Needs support</small></div><div class="mini-momentum-row"><strong>All stable</strong><span class="trend-pill neutral"><span class="trend-icon">→</span> Steady</span></div></div>';

  const steadyCard = `<div class="mini-momentum-item item-steady"><div class="mini-momentum-header"><span class="mini-momentum-icon">→</span><small>Steady</small></div><div class="mini-momentum-row"><strong>${steadyCount} students</strong><span class="trend-pill neutral"><span class="trend-icon">→</span> Stable</span></div></div>`;

  panel.innerHTML = `${topCard}${dropCard}${steadyCard}`;
}

async function editStudent(student) {
  const fullName = prompt('Edit student full name:', student.full_name || '');
  if (fullName === null) return;

  const gender = prompt('Edit student gender (Male/Female):', student.gender || '');
  if (gender === null) return;

  const classroomOptions = classroomsCache.length
    ? classroomsCache.map((room) => room.name).join(', ')
    : 'No classrooms available';
  const classroomName = prompt(`Edit classroom name (${classroomOptions}):`, student.classroom_name || '');
  if (classroomName === null) return;

  const classroomId = classroomName.trim() ? resolveClassroomIdByName(classroomName) : null;
  if (classroomName.trim() && !classroomId) {
    return alert('Classroom not found. Please use an exact classroom name from the list shown.');
  }

  const feesDue = Number(prompt('Edit total fees due (GHS):', Number(student.total_fees_due || 0)));
  if (Number.isNaN(feesDue)) {
    return alert('Please enter a valid fees amount.');
  }

  const { ok, data } = await apiSend('PUT', `/api/admin/students/${student.id}`, {
    fullName: fullName.trim(),
    classroomId,
    totalFeesDue: feesDue,
    gender: gender.trim() || null,
    dateOfBirth: null,
    photoUrl: student.photo_url || null,
  });

  if (!ok) return alert(data.message);
  loadStudents();
}

async function loadStudents() {
  const students = await apiGet('/api/admin/students');
  const tbody = document.getElementById('students-table-body');

  const rows = await Promise.all(students.map(async (s) => {
    const trendMarkup = await getStudentTrend(s.id);

    if (studentEditId === s.id) {
      return `
        <tr class="inline-edit-row">
          <td>${escapeHtml(s.student_id_number)}</td>
          <td><input class="inline-edit-input" type="text" value="${escapeHtml(s.full_name)}" data-field="fullName" /></td>
          <td>${getClassroomSelectHtml(s.classroom_name || '')}</td>
          <td><input class="inline-edit-input" type="number" min="0" step="0.01" value="${Number(s.total_fees_due || 0).toFixed(2)}" data-field="feesDue" /></td>
          <td>${Number(s.amount_paid).toFixed(2)}</td>
          <td>${trendMarkup}</td>
          <td>
            <div class="inline-edit-actions">
              <button class="btn btn-primary" type="button" data-action="save-student" data-id="${s.id}">Save</button>
              <button class="btn btn-outline" type="button" data-action="cancel-student" data-id="${s.id}" style="margin-left:8px;">Cancel</button>
            </div>
          </td>
        </tr>`;
    }

    return `
      <tr>
        <td>${escapeHtml(s.student_id_number)}</td>
        <td>${escapeHtml(s.full_name)}</td>
        <td>${escapeHtml(s.classroom_name || '-')}</td>
        <td>${Number(s.total_fees_due).toFixed(2)}</td>
        <td>${Number(s.amount_paid).toFixed(2)}</td>
        <td>${trendMarkup}</td>
        <td>
          <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" data-action="edit-student" data-id="${s.id}">Edit</button>
          <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteStudent(${s.id})">Delete</button>
        </td>
      </tr>`;
  }));

  tbody.innerHTML = students.length
    ? rows.join('')
    : '<tr><td colspan="7">No students yet.</td></tr>';

  renderStudentMomentumOverview(students);
}

document.getElementById('students-table-body').addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const studentId = Number(target.dataset.id);

  if (action === 'edit-student') {
    studentEditId = studentId;
    loadStudents();
    return;
  }

  if (action === 'cancel-student') {
    studentEditId = null;
    loadStudents();
    return;
  }

  if (action === 'save-student') {
    const row = target.closest('tr');
    const fullName = row.querySelector('[data-field="fullName"]').value.trim();
    const classroomName = row.querySelector('[data-role="classroom"]').value;
    const feesDue = Number(row.querySelector('[data-field="feesDue"]').value);
    const gender = row.querySelector('[data-field="gender"]') ? row.querySelector('[data-field="gender"]').value : null;

    if (!fullName) {
      return alert('Student name cannot be empty.');
    }

    if (Number.isNaN(feesDue)) {
      return alert('Please enter a valid fees amount.');
    }

    const classroomId = classroomName ? resolveClassroomIdByName(classroomName) : null;
    if (classroomName && !classroomId) {
      return alert('Classroom not found. Please choose a valid classroom.');
    }

    const { ok, data } = await apiSend('PUT', `/api/admin/students/${studentId}`, {
      fullName,
      classroomId,
      totalFeesDue: feesDue,
      gender: gender || null,
      dateOfBirth: null,
      photoUrl: null,
    });

    if (!ok) return alert(data.message);
    studentEditId = null;
    loadStudents();
  }
});

document.getElementById('student-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const fileInput = document.getElementById('studentPhoto');
  let photoUrl = null;

  if (fileInput && fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    const reader = new FileReader();
    const readFile = () => new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.readAsDataURL(file);
    });

    try {
      photoUrl = await readFile();
    } catch (error) {
      return alert(error.message);
    }
  }

  const payload = {
    studentIdNumber: document.getElementById('studentIdNumber').value.trim(),
    fullName: document.getElementById('studentFullName').value.trim(),
    email: document.getElementById('studentEmail').value.trim(),
    password: document.getElementById('studentPassword').value,
    gender: document.getElementById('studentGender').value,
    classroomId: document.getElementById('studentClassroom').value || null,
    totalFeesDue: document.getElementById('studentFeesDue').value || 0,
    photoUrl,
  };

  const { ok, data } = await apiSend('POST', '/api/admin/students', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadStudents();
  loadStats();
});

async function deleteStudent(id) {
  if (!confirm('Delete this student account? This also deletes their reports and payment history.')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/students/${id}`);
  if (!ok) return alert(data.message);
  loadStudents();
  loadStats();
}

// ---------------------- SUBJECTS ----------------------
function formatAnnouncementDate(dateValue) {
  return new Date(dateValue).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function loadAnnouncements() {
  const announcements = await apiGet('/api/admin/announcements');
  const tbody = document.getElementById('announcements-table-body');

  tbody.innerHTML = announcements.length
    ? announcements.map((announcement) => `
      <tr>
        <td>${announcement.title}</td>
        <td>${announcement.message}</td>
        <td>${formatAnnouncementDate(announcement.created_at)}</td>
        <td>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" onclick="editAnnouncement(${announcement.id}, '${announcement.title.replace(/'/g, "\\'")}', '${announcement.message.replace(/'/g, "\\'")}')">Edit</button>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteAnnouncement(${announcement.id})">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="4">No announcements yet.</td></tr>';
}

function editAnnouncement(id, currentTitle, currentMessage) {
  const title = prompt('Edit announcement title:', currentTitle || '');
  if (title === null) return;
  const message = prompt('Edit announcement message:', currentMessage || '');
  if (message === null) return;

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  if (!trimmedTitle || !trimmedMessage) {
    return alert('Title and message cannot be empty.');
  }

  apiSend('PUT', `/api/admin/announcements/${id}`, {
    title: trimmedTitle,
    message: trimmedMessage,
  }).then(({ ok, data }) => {
    if (!ok) return alert(data.message);
    loadAnnouncements();
  });
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/announcements/${id}`);
  if (!ok) return alert(data.message);
  loadAnnouncements();
}

document.getElementById('announcement-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    title: document.getElementById('announcementTitle').value.trim(),
    message: document.getElementById('announcementMessage').value.trim(),
  };

  const { ok, data } = await apiSend('POST', '/api/admin/announcements', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadAnnouncements();
});

async function loadSubjects() {
  const subjects = await apiGet('/api/admin/subjects');
  const tbody = document.getElementById('subjects-table-body');

  tbody.innerHTML = subjects.length
    ? subjects.map((subject) => `
      <tr>
        <td>${subject.name}</td>
        <td>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" onclick="editSubject(${subject.id}, '${subject.name.replace(/'/g, "\\'")}' )">Edit</button>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteSubject(${subject.id})">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="2">No subjects yet.</td></tr>';
}

async function deleteSubject(id) {
  if (!confirm('Delete this subject? It may be linked to student report data.')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/subjects/${id}`);
  if (!ok) return alert(data.message);
  loadSubjects();
}

function editSubject(id, currentName) {
  const nextName = prompt('Edit subject name:', currentName);
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) return alert('Subject name cannot be empty.');

  apiSend('PUT', `/api/admin/subjects/${id}`, { name: trimmed })
    .then(({ ok, data }) => {
      if (!ok) return alert(data.message);
      loadSubjects();
    });
}

document.getElementById('subject-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('subjectName').value.trim(),
  };

  const { ok, data } = await apiSend('POST', '/api/admin/subjects', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadSubjects();
});

async function searchStudents(query) {
  const resultsTable = document.getElementById('student-search-results');
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    resultsTable.innerHTML = '<tr><td colspan="6">Start typing to search students.</td></tr>';
    return;
  }

  const students = await apiGet('/api/admin/students');
  const matches = students.filter((student) => student.full_name.toLowerCase().includes(trimmedQuery.toLowerCase()));

  if (!matches.length) {
    resultsTable.innerHTML = '<tr><td colspan="6">No student matches your search.</td></tr>';
    return;
  }

  const rows = await Promise.all(matches.map(async (student) => {
    const trendMarkup = await getStudentTrend(student.id);
    return `
      <tr>
        <td>${student.student_id_number}</td>
        <td>${student.full_name}</td>
        <td>${student.classroom_name || '-'}</td>
        <td>${Number(student.total_fees_due).toFixed(2)}</td>
        <td>${Number(student.amount_paid).toFixed(2)}</td>
        <td>${trendMarkup}</td>
      </tr>`;
  }));

  resultsTable.innerHTML = rows.join('');
}

document.getElementById('admin-student-search').addEventListener('input', (event) => {
  searchStudents(event.target.value);
});

// ---------------------- LOGOUT ----------------------
document.getElementById('logout-link').addEventListener('click', (event) => {
  event.preventDefault();
  localStorage.clear();
  window.location.href = '/login.html';
});

// ---------------------- INITIAL LOAD ----------------------
loadStats();
loadClassrooms();
loadTeachers();
loadStudents();
loadAnnouncements();
loadSubjects();
