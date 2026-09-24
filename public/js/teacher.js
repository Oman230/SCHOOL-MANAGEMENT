// public/js/teacher.js
// Powers the teacher dashboard: loading the teacher's profile and class list,
// building the score-entry form for a chosen student, and saving reports.

const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Redirect to login if not logged in as a teacher
if (!token || !user || user.role !== 'teacher') {
  window.location.href = '/login.html';
}

let allSubjects = []; // cached list of subjects, loaded once and reused for every student

function isValidImageDataUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) return false;

  const [, encoded] = trimmed.split(',', 2);
  if (!encoded) return false;

  try {
    const binary = atob(encoded);
    if (binary.length < 8) return false;
    const marker = binary.slice(0, 8);
    const pngHeader = '\x89PNG\r\n\x1a\n';
    const jpegHeader = '\xFF\xD8\xFF';
    const gifHeader = 'GIF87a';
    const gifHeader89a = 'GIF89a';

    if (trimmed.toLowerCase().startsWith('data:image/png')) return marker === pngHeader;
    if (trimmed.toLowerCase().startsWith('data:image/jpeg')) return binary.slice(0, 3) === jpegHeader;
    if (trimmed.toLowerCase().startsWith('data:image/gif')) return binary.slice(0, 6) === gifHeader || binary.slice(0, 6) === gifHeader89a;
    if (trimmed.toLowerCase().startsWith('data:image/webp')) return binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP';
  } catch (error) {
    return false;
  }

  return false;
}

function resolvePhotoSource(photoUrl, fallbackUrl) {
  if (typeof photoUrl === 'string' && isValidImageDataUrl(photoUrl)) {
    return photoUrl;
  }
  return fallbackUrl;
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
    const reports = await apiGet(`/api/teachers/students/${studentId}/reports`);
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

// Helper for authenticated GET requests
async function apiGet(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = '/login.html';
  }
  return response.json();
}

// Helper for authenticated POST requests
async function apiPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await response.json() };
}

// ---------------------- LOAD TEACHER PROFILE ----------------------
async function loadProfile() {
  const profile = await apiGet('/api/teachers/me');
  document.getElementById('welcome-heading').textContent = `Welcome, ${profile.full_name}!`;
  document.getElementById('profile-name').textContent = profile.full_name;
  document.getElementById('profile-email').textContent = profile.email;
  document.getElementById('profile-phone').textContent = profile.phone || '-';
  document.getElementById('profile-classroom').textContent = profile.classroom_name
    ? `${profile.classroom_name} (${profile.classroom_level})`
    : 'Not yet assigned';

  const teacherPhoto = document.getElementById('teacher-photo');
  const fallbackPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.full_name || 'Teacher')}&background=4f46e5&color=fff`;
  teacherPhoto.src = resolvePhotoSource(profile.photo_url, fallbackPhoto);
  teacherPhoto.alt = `${profile.full_name || 'Teacher'} portrait`;
}

// ---------------------- LOAD CLASS LIST ----------------------
async function loadClassList() {
  const students = await apiGet('/api/teachers/my-class');
  sessionStorage.setItem('teacherClassStudents', JSON.stringify(students));
  const tbody = document.getElementById('class-table-body');

  if (!Array.isArray(students) || !students.length) {
    tbody.innerHTML = '<tr><td colspan="5">No students found in your class yet.</td></tr>';
    return;
  }

  const rows = await Promise.all(students.map(async (student) => {
    const balance = (Number(student.total_fees_due) - Number(student.amount_paid)).toFixed(2);
    const trendMarkup = await getStudentTrend(student.id);

    return `
      <tr>
        <td>${student.student_id_number}</td>
        <td>${student.full_name}</td>
        <td>${balance}</td>
        <td>${trendMarkup}</td>
        <td>
          <button class="btn btn-primary" style="padding:6px 12px;font-size:0.82rem;"
                  onclick="startReport(${student.id}, '${student.full_name.replace(/'/g, "\\'")}')">
            Fill Report
          </button>
          <button class="btn btn-outline" style="padding:6px 12px;font-size:0.82rem; color:var(--color-primary); border-color:var(--color-primary);"
                  onclick="printLatestReport(${student.id})">
            Print PDF
          </button>
          <button class="btn btn-accent" style="padding:6px 12px;font-size:0.82rem; background:linear-gradient(135deg, #ef4444 0%, #f97316 100%);"
                  onclick="deleteStudentFromClass(${student.id}, '${student.full_name.replace(/'/g, "\\'")}')">
            Delete
          </button>
        </td>
      </tr>`;
  }));

  tbody.innerHTML = rows.join('');
}

document.getElementById('teacher-photo-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const photoInput = document.getElementById('teacherPhotoUpload');
  if (!photoInput || !photoInput.files || !photoInput.files[0]) {
    alert('Please choose a passport photo to upload.');
    return;
  }

  const reader = new FileReader();
  const photoUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(photoInput.files[0]);
  });

  if (!isValidImageDataUrl(photoUrl)) {
    alert('Please upload a valid PNG, JPG, GIF, or WEBP image.');
    return;
  }

  const response = await fetch('/api/teachers/me/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ photoUrl }),
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not upload profile photo.');
    return;
  }

  document.getElementById('teacher-photo').src = photoUrl;
  event.target.reset();
  alert('Passport photo updated successfully.');
});

async function searchClassStudents(query) {
  const resultsTable = document.getElementById('teacher-search-results');
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    resultsTable.innerHTML = '<tr><td colspan="4">Start typing to search your class.</td></tr>';
    return;
  }

  const currentStudents = JSON.parse(sessionStorage.getItem('teacherClassStudents') || '[]');
  const matches = currentStudents.filter((student) => student.full_name.toLowerCase().includes(trimmedQuery.toLowerCase()));

  if (!matches.length) {
    resultsTable.innerHTML = '<tr><td colspan="4">No student matches your search.</td></tr>';
    return;
  }

  const rows = await Promise.all(matches.map(async (student) => {
    const trendMarkup = await getStudentTrend(student.id);
    return `
      <tr>
        <td>${student.student_id_number}</td>
        <td>${student.full_name}</td>
        <td>${(Number(student.total_fees_due) - Number(student.amount_paid)).toFixed(2)}</td>
        <td>${trendMarkup}</td>
      </tr>`;
  }));

  resultsTable.innerHTML = rows.join('');
}

document.getElementById('teacher-student-search').addEventListener('input', (event) => {
  searchClassStudents(event.target.value);
});

document.getElementById('teacher-student-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const photoInput = document.getElementById('teacherStudentPhoto');
  let photoUrl = null;

  if (photoInput && photoInput.files && photoInput.files[0]) {
    const reader = new FileReader();
    photoUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the student image.'));
      reader.readAsDataURL(photoInput.files[0]);
    });
  }

  const payload = {
    studentIdNumber: document.getElementById('teacherStudentIdNumber').value.trim(),
    fullName: document.getElementById('teacherStudentName').value.trim(),
    email: document.getElementById('teacherStudentEmail').value.trim(),
    password: document.getElementById('teacherStudentPassword').value,
    gender: document.getElementById('teacherStudentGender').value,
    parentName: document.getElementById('teacherParentName').value.trim(),
    parentPhone: document.getElementById('teacherParentPhone').value.trim(),
    photoUrl,
  };

  const response = await fetch('/api/teachers/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not add student.');
    return;
  }

  event.target.reset();
  loadClassList();
  alert('Student added to your class successfully.');
});

async function deleteStudentFromClass(studentId, studentName) {
  const confirmed = window.confirm(`Delete ${studentName} from your class? This action cannot be undone.`);
  if (!confirmed) return;

  const response = await fetch(`/api/teachers/students/${studentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not delete student.');
    return;
  }

  loadClassList();
  alert(data.message || `${studentName} was deleted.`);
}

// ---------------------- START FILLING A REPORT FOR A STUDENT ----------------------
async function startReport(studentId, studentName) {
  document.getElementById('report-student-id').value = studentId;
  document.getElementById('report-student-label').textContent = `Filling report for: ${studentName}`;
  document.getElementById('report-form').style.display = 'block';

  // Load the list of subjects once, then reuse it for every student
  if (!allSubjects.length) {
    allSubjects = await apiGet('/api/teachers/subjects');
  }

  // Build one input row per subject for entering class score + exam score
  const scoresBody = document.getElementById('subject-scores-body');
  scoresBody.innerHTML = allSubjects
    .map(
      (subject) => `
      <tr data-subject-id="${subject.id}">
        <td>${subject.name}</td>
        <td><input type="number" min="0" max="50" class="class-score-input" style="width:80px; padding:6px;" value="0" /></td>
        <td><input type="number" min="0" max="50" class="exam-score-input" style="width:80px; padding:6px;" value="0" /></td>
      </tr>`
    )
    .join('');

  // Scroll down so the teacher can see the form immediately
  document.getElementById('report-section').scrollIntoView({ behavior: 'smooth' });
}

// ---------------------- SAVE REPORT ----------------------
document.getElementById('report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusText = document.getElementById('report-save-status');
  statusText.textContent = 'Saving...';
  statusText.style.color = 'var(--color-muted)';

  // Gather every subject's scores from the table rows we generated
  const scores = Array.from(document.querySelectorAll('#subject-scores-body tr')).map((row) => ({
    subjectId: Number(row.dataset.subjectId),
    classScore: Number(row.querySelector('.class-score-input').value) || 0,
    examScore: Number(row.querySelector('.exam-score-input').value) || 0,
  }));

  const payload = {
    studentId: Number(document.getElementById('report-student-id').value),
    academicYear: document.getElementById('academicYear').value,
    term: document.getElementById('term').value,
    attendance: document.getElementById('attendance').value,
    classTeacherRemark: document.getElementById('classTeacherRemark').value,
    headteacherRemark: document.getElementById('headteacherRemark').value,
    scores,
  };

  const { ok, data } = await apiPost('/api/teachers/reports', payload);

  if (!ok) {
    statusText.textContent = data.message || 'Could not save report.';
    statusText.style.color = 'var(--color-danger)';
    return;
  }

  statusText.textContent = 'Report saved successfully!';
  statusText.style.color = 'var(--color-success)';
});

// ---------------------- PRINT A STUDENT'S MOST RECENT REPORT ----------------------
async function printLatestReport(studentId) {
  const reports = await apiGet(`/api/teachers/students/${studentId}/reports`);

  if (!reports.length) {
    alert('This student does not have any saved reports yet.');
    return;
  }

  const latestReportId = reports[0].id; // reports are already sorted newest-first by the backend

  // Fetch the PDF as a file and open it in a new tab (same approach as the student dashboard)
  const response = await fetch(`/api/reports/${latestReportId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blob = await response.blob();
  window.open(URL.createObjectURL(blob), '_blank');
}

// ---------------------- LOGOUT ----------------------
document.getElementById('logout-link').addEventListener('click', (event) => {
  event.preventDefault();
  localStorage.clear();
  window.location.href = '/login.html';
});

// ---------------------- INITIAL LOAD ----------------------
loadProfile();
loadClassList();
