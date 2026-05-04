'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getRequestUsername } = require('../../app/requestContext');

const ROLE_ADMIN = new Set(['admin', 'superadmin']);
const ROLE_HR = new Set(['hr_manager']);
const SECTION_WEIGHTS = {
  technical: 0.4,
  practical: 0.3,
  logic: 0.2,
  behavioral: 0.1
};
const DISPLAY_SECTIONS = ['technical', 'practical', 'logic', 'behavioral', 'follow_up'];
const DEFAULT_QUESTION_COUNTS = {
  technical: 10,
  practical: 5,
  logic: 5,
  behavioral: 3,
  follow_up: 5
};

const uploadRoot = path.join(__dirname, '../../../PUBLIC/uploads/interviews');
fs.mkdirSync(uploadRoot, { recursive: true });

let aiClient = null;
let aiModel = null;
let aiModelName = '';

async function extractPdfText(buffer) {
  if (typeof pdfParse === 'function') {
    const parsed = await pdfParse(buffer);
    return parsed?.text || '';
  }

  if (pdfParse && typeof pdfParse.default === 'function') {
    const parsed = await pdfParse.default(buffer);
    return parsed?.text || '';
  }

  if (pdfParse && typeof pdfParse.PDFParse === 'function') {
    const parser = new pdfParse.PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed?.text || '';
    } finally {
      if (typeof parser.destroy === 'function') {
        await parser.destroy().catch(() => {});
      }
    }
  }

  throw new Error('Unsupported pdf-parse export format');
}

function normalizeText(value, fallback = '') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

function normalizeNullableText(value) {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function ensureAi(config = {}) {
  if (!config.geminiApiKey) return null;
  if (!aiClient) aiClient = new GoogleGenerativeAI(config.geminiApiKey);
  if (!aiModel) {
    const preferred = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-flash-latest'];
    for (const modelName of preferred) {
      try {
        aiModel = aiClient.getGenerativeModel({ model: modelName });
        aiModelName = modelName;
        break;
      } catch (_error) {
        // Try next model.
      }
    }
  }
  return aiModel;
}

function cleanJsonResponse(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function monthWindow(monthValue) {
  const raw = String(monthValue || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getMonth();
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!numbers.length) return 0;
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(2));
}

function scoreBand(score) {
  const value = Number(score || 0);
  if (value >= 75) return 'green';
  if (value >= 60) return 'yellow';
  return 'red';
}

function buildSkillMatchScore(profile, appliedRole = '') {
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];
  const techStack = Array.isArray(profile?.tech_stack) ? profile.tech_stack : [];
  const roleTokens = String(appliedRole || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const pool = [...skills, ...techStack].map((item) => String(item).toLowerCase());
  const overlap = roleTokens.filter((token) => pool.some((item) => item.includes(token))).length;
  const breadth = Math.min(pool.length * 6, 60);
  return Math.max(20, Math.min(100, breadth + overlap * 10));
}

function normalizeQuestionItem(item, section, index) {
  if (!item) {
    return {
      question: `${section} question ${index + 1}`,
      expected_answer: '',
      section
    };
  }

  if (typeof item === 'string') {
    return {
      question: item,
      expected_answer: '',
      section
    };
  }

  return {
    question: normalizeText(item.question || item.prompt || item.task || item.title || `${section} question ${index + 1}`),
    expected_answer: normalizeText(item.expected_answer || item.answer || item.solution || item.expectedAnswer || ''),
    section,
    focus_area: normalizeNullableText(item.focus_area || item.focusArea || item.area || ''),
    skill: normalizeNullableText(item.skill || ''),
    difficulty: normalizeNullableText(item.difficulty || '')
  };
}

function normalizeAnalysisPayload(payload, fallback = {}) {
  const profile = payload?.candidate_profile || {};
  const panel = payload?.interview_panel || {};

  const normalized = {
    candidate_profile: {
      name: normalizeNullableText(profile.name) || normalizeNullableText(fallback.candidate_name) || 'Unknown Candidate',
      experience_level: normalizeNullableText(profile.experience_level) || 'Mid Level',
      skills: Array.isArray(profile.skills) ? profile.skills.map((skill) => normalizeText(skill)).filter(Boolean) : [],
      tech_stack: Array.isArray(profile.tech_stack) ? profile.tech_stack.map((skill) => normalizeText(skill)).filter(Boolean) : [],
      strengths: Array.isArray(profile.strengths) ? profile.strengths.map((item) => normalizeText(item)).filter(Boolean) : [],
      weaknesses: Array.isArray(profile.weaknesses) ? profile.weaknesses.map((item) => normalizeText(item)).filter(Boolean) : [],
      risk_flags: Array.isArray(profile.risk_flags) ? profile.risk_flags.map((item) => normalizeText(item)).filter(Boolean) : []
    },
    interview_panel: {
      technical: Array.isArray(panel.technical) ? panel.technical.map((item, index) => normalizeQuestionItem(item, 'technical', index)) : [],
      practical: Array.isArray(panel.practical) ? panel.practical.map((item, index) => normalizeQuestionItem(item, 'practical', index)) : [],
      logic: Array.isArray(panel.logic) ? panel.logic.map((item, index) => normalizeQuestionItem(item, 'logic', index)) : [],
      behavioral: Array.isArray(panel.behavioral) ? panel.behavioral.map((item, index) => normalizeQuestionItem(item, 'behavioral', index)) : []
    },
    follow_up_questions: Array.isArray(payload?.follow_up_questions)
      ? payload.follow_up_questions.map((item, index) => normalizeQuestionItem(item, 'follow_up', index))
      : [],
    recommended_role: normalizeNullableText(payload?.recommended_role) || normalizeNullableText(fallback.applied_role) || 'General Technical Role',
    difficulty_level: normalizeText(payload?.difficulty_level, 'medium').toLowerCase()
  };

  normalized.skill_match_score = buildSkillMatchScore(normalized.candidate_profile, fallback.applied_role || normalized.recommended_role);
  return normalized;
}

function extractSkillsFromText(text) {
  const keywords = [
    'javascript', 'typescript', 'react', 'next.js', 'node.js', 'express', 'postgresql', 'mysql',
    'sql', 'api', 'rest', 'graphql', 'html', 'css', 'tailwind', 'python', 'django', 'java',
    'spring boot', 'aws', 'docker', 'kubernetes', 'git', 'excel', 'power bi', 'erp', 'hr'
  ];
  const lower = String(text || '').toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword)).map((keyword) => keyword.replace(/\b\w/g, (ch) => ch.toUpperCase()));
}

function inferExperienceLevel(text) {
  const lower = String(text || '').toLowerCase();
  const match = lower.match(/(\d+)\+?\s+years?/);
  const years = match ? Number(match[1]) : 0;
  if (years >= 8) return 'Senior';
  if (years >= 4) return 'Mid Level';
  if (years >= 1) return 'Junior';
  return 'Entry Level';
}

function inferCandidateName(text, fallbackName = '') {
  if (fallbackName) return fallbackName;
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const probable = lines.find((line) => /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(line));
  return probable || 'Unknown Candidate';
}

function buildFallbackAnalysis(resumeText, meta = {}) {
  const skills = extractSkillsFromText(resumeText);
  const roleLabel = meta.applied_role || 'Software Engineer';
  const experienceLevel = inferExperienceLevel(resumeText);
  const name = inferCandidateName(resumeText, meta.candidate_name);
  const weaknesses = [];
  const riskFlags = [];

  if (!skills.includes('SQL')) weaknesses.push('SQL depth not clearly visible');
  if (!skills.includes('Node.Js') && !skills.includes('Python')) weaknesses.push('Backend ownership is not clearly demonstrated');
  if (!resumeText || resumeText.length < 200) riskFlags.push('Resume content is limited for deep screening');

  const questionFor = (section, title, expected, count) =>
    Array.from({ length: count }, (_, index) => ({
      question: `${title} ${index + 1} for ${roleLabel}`,
      expected_answer: expected,
      section
    }));

  return normalizeAnalysisPayload({
    candidate_profile: {
      name,
      experience_level: experienceLevel,
      skills,
      tech_stack: skills.slice(0, 8),
      strengths: skills.length ? [`Hands-on exposure in ${skills.slice(0, 3).join(', ')}`] : ['Resume available for screening'],
      weaknesses,
      risk_flags: riskFlags
    },
    interview_panel: {
      technical: questionFor('technical', 'Explain a real technical decision you made', 'Candidate should explain architecture, tradeoff, and measurable impact.', DEFAULT_QUESTION_COUNTS.technical),
      practical: questionFor('practical', 'Solve this real production problem', 'Candidate should outline debugging path, fix strategy, and validation steps.', DEFAULT_QUESTION_COUNTS.practical),
      logic: questionFor('logic', 'Work through this logic scenario', 'Candidate should break the problem into steps and reason clearly.', DEFAULT_QUESTION_COUNTS.logic),
      behavioral: questionFor('behavioral', 'Share a behavior example', 'Candidate should respond with a concrete STAR-style example.', DEFAULT_QUESTION_COUNTS.behavioral)
    },
    follow_up_questions: questionFor('follow_up', 'Probe one weak area further', 'Candidate should respond with evidence, ownership, and a specific example.', DEFAULT_QUESTION_COUNTS.follow_up),
    recommended_role: roleLabel,
    difficulty_level: experienceLevel === 'Senior' ? 'hard' : experienceLevel === 'Mid Level' ? 'medium' : 'easy'
  }, meta);
}

async function parseResumeFile(file) {
  if (!file) throw new Error('Resume file is required');
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const buffer = fs.readFileSync(file.path);
  let extracted = '';

  if (mime.includes('pdf') || ext === '.pdf') {
    extracted = await extractPdfText(buffer);
  } else if (mime.includes('word') || ext === '.docx') {
    const parsed = await mammoth.extractRawText({ buffer });
    extracted = parsed.value || '';
  } else if (ext === '.txt' || mime.startsWith('text/')) {
    extracted = buffer.toString('utf8');
  } else if (ext === '.doc') {
    extracted = buffer.toString('utf8').replace(/[^\x20-\x7E\r\n]+/g, ' ').trim();
  } else {
    throw new Error('Unsupported resume format. Please upload PDF, DOCX, DOC, or TXT.');
  }

  const normalized = extracted.replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return {
    rawText: extracted,
    parsedText: normalized
  };
}

async function analyzeResumeWithAi(config, resumeText, meta = {}) {
  const model = ensureAi(config);
  if (!model || !resumeText) return buildFallbackAnalysis(resumeText, meta);

  const prompt = `You are a senior technical interviewer and hiring manager.

Analyze the resume and generate:

1. Deep candidate profile (skills, strengths, weaknesses, risks)
2. 10 technical questions with answers
3. 5 real-world practical tasks with solutions
4. 5 logical reasoning questions
5. 3 behavioral questions
6. 5 follow-up questions based on weak areas

Rules:

* Questions must match candidate skills
* Include SQL, API, backend, frontend if applicable
* Practical tasks must simulate real job problems
* Answers must be correct and concise
* Output strictly in JSON format

Candidate target role: ${meta.applied_role || 'Not specified'}
Department: ${meta.department || 'Not specified'}

Output JSON exactly in this shape:
{
  "candidate_profile": {
    "name": "",
    "experience_level": "",
    "skills": [],
    "tech_stack": [],
    "strengths": [],
    "weaknesses": [],
    "risk_flags": []
  },
  "interview_panel": {
    "technical": [{ "question": "", "expected_answer": "" }],
    "practical": [{ "question": "", "expected_answer": "" }],
    "logic": [{ "question": "", "expected_answer": "" }],
    "behavioral": [{ "question": "", "expected_answer": "" }]
  },
  "follow_up_questions": [{ "question": "", "expected_answer": "", "focus_area": "" }],
  "recommended_role": "",
  "difficulty_level": "easy"
}

Resume:
${resumeText}`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const parsed = safeJsonParse(cleanJsonResponse(response.text()));
    return normalizeAnalysisPayload(parsed || {}, meta);
  } catch (error) {
    console.warn('[Interview Panel] AI analysis fallback:', error.message);
    return buildFallbackAnalysis(resumeText, meta);
  }
}

function mapScoresBySection(scoreRows) {
  const map = {
    technical: {},
    practical: {},
    logic: {},
    behavioral: {},
    follow_up: {}
  };
  for (const row of scoreRows) {
    if (!map[row.section]) map[row.section] = {};
    map[row.section][String(row.question_index)] = {
      score: Number(row.score || 0),
      remarks: row.remarks || ''
    };
  }
  return map;
}

function computeInterviewScore(aiQuestionsJson, scoreRows) {
  const questionMap = aiQuestionsJson || {};
  const scoreMap = mapScoresBySection(scoreRows);
  const sectionAverages = {};

  for (const section of DISPLAY_SECTIONS) {
    const source = section === 'follow_up'
      ? (questionMap.follow_up_questions || [])
      : ((questionMap.interview_panel && questionMap.interview_panel[section]) || []);
    const sectionScores = source.map((_item, index) => Number(scoreMap?.[section]?.[String(index)]?.score || 0));
    sectionAverages[section] = average(sectionScores);
  }

  const finalScore = Number((
    (sectionAverages.technical * SECTION_WEIGHTS.technical) +
    (sectionAverages.practical * SECTION_WEIGHTS.practical) +
    (sectionAverages.logic * SECTION_WEIGHTS.logic) +
    (sectionAverages.behavioral * SECTION_WEIGHTS.behavioral)
  ).toFixed(2));

  return {
    sectionAverages,
    finalScore,
    scoreBand: scoreBand(finalScore)
  };
}

function buildFallbackFinalEvaluation(interview, scoreSummary) {
  const score = Number(scoreSummary.finalScore || 0);
  let decision = 'Reject';
  if (score >= 75) decision = 'Hire';
  else if (score >= 60) decision = 'Consider';

  return {
    final_decision: decision,
    confidence_score: Math.max(45, Math.min(98, Math.round(score))),
    justification: `Weighted interview score is ${score}. Decision is based on technical depth, practical execution, logic, and behavioral fit.`,
    risk_analysis: score < 60 ? 'Candidate needs stronger proof of delivery before role fit is confirmed.' : 'No critical hiring blocker identified beyond normal reference checks.',
    salary_range_suggestion: score >= 80 ? 'Upper-mid band for role level' : score >= 65 ? 'Mid band for role level' : 'Entry or lower-mid band for role level'
  };
}

async function generateFinalEvaluation(config, interview, scoreSummary) {
  const model = ensureAi(config);
  if (!model) return buildFallbackFinalEvaluation(interview, scoreSummary);

  const weakAreas = Array.isArray(interview.ai_profile_json?.candidate_profile?.weaknesses)
    ? interview.ai_profile_json.candidate_profile.weaknesses
    : [];

  const prompt = `You are a senior hiring manager.

Resume:
${interview.resume_parsed_text || interview.resume_raw_text || ''}

Candidate profile:
${JSON.stringify(interview.ai_profile_json?.candidate_profile || {}, null, 2)}

Interview scoring summary:
${JSON.stringify(scoreSummary, null, 2)}

Weak areas:
${JSON.stringify(weakAreas, null, 2)}

Return strict JSON only:
{
  "final_decision": "Hire / Consider / Reject",
  "confidence_score": 0,
  "justification": "",
  "risk_analysis": "",
  "salary_range_suggestion": ""
}`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const parsed = safeJsonParse(cleanJsonResponse(response.text()));
    if (parsed && parsed.final_decision) {
      return {
        final_decision: normalizeText(parsed.final_decision, 'Consider'),
        confidence_score: Number(parsed.confidence_score || 0),
        justification: normalizeText(parsed.justification),
        risk_analysis: normalizeText(parsed.risk_analysis),
        salary_range_suggestion: normalizeText(parsed.salary_range_suggestion)
      };
    }
  } catch (error) {
    console.warn('[Interview Panel] AI final evaluation fallback:', error.message);
  }

  return buildFallbackFinalEvaluation(interview, scoreSummary);
}

function buildInterviewListRow(interview) {
  const profile = interview.ai_profile_json?.candidate_profile || {};
  const skillCount = Array.isArray(profile.skills) ? profile.skills.length : 0;
  return {
    id: interview.id,
    candidate_name: interview.candidate_name,
    applied_role: interview.applied_role,
    department: interview.department,
    experience_level: profile.experience_level || '-',
    recommended_role: interview.recommended_role || interview.ai_profile_json?.recommended_role || '-',
    difficulty_level: interview.difficulty_level || interview.ai_profile_json?.difficulty_level || 'medium',
    skill_match_score: Number(interview.skill_match_score || 0),
    final_score: Number(interview.final_score || 0),
    score_band: scoreBand(interview.final_score),
    result: interview.result || 'Pending',
    confidence_score: Number(interview.confidence_score || 0),
    status: interview.status || 'draft',
    created_at: interview.created_at,
    updated_at: interview.updated_at,
    skill_count: skillCount
  };
}

function buildInterviewExportWorkbook(interview, scoreRows) {
  const workbook = xlsx.utils.book_new();
  const profile = interview.ai_profile_json?.candidate_profile || {};
  const panel = interview.ai_questions_json?.interview_panel || {};
  const followUps = interview.ai_questions_json?.follow_up_questions || [];
  const scoreSummary = computeInterviewScore(interview.ai_questions_json, scoreRows);
  const finalAi = interview.ai_final_json || {};
  const scoreMap = mapScoresBySection(scoreRows);

  const summaryRows = [
    ['Company', 'Joyo Plastics'],
    ['Candidate Name', interview.candidate_name || profile.name || '-'],
    ['Applied Role', interview.applied_role || '-'],
    ['Department', interview.department || '-'],
    ['Recommended Role', interview.recommended_role || interview.ai_questions_json?.recommended_role || '-'],
    ['Difficulty', interview.difficulty_level || interview.ai_questions_json?.difficulty_level || 'medium'],
    ['Experience Level', profile.experience_level || '-'],
    ['Skill Match Score', Number(interview.skill_match_score || 0)],
    ['Final Score', Number(interview.final_score || 0)],
    ['Decision', interview.result || finalAi.final_decision || 'Pending'],
    ['Confidence', Number(interview.confidence_score || finalAi.confidence_score || 0)],
    ['Strengths', (profile.strengths || []).join(', ')],
    ['Weaknesses', (profile.weaknesses || []).join(', ')],
    ['Risk Flags', (profile.risk_flags || []).join(', ')],
    ['AI Justification', finalAi.justification || ''],
    ['Risk Analysis', finalAi.risk_analysis || ''],
    ['Salary Suggestion', finalAi.salary_range_suggestion || '']
  ];
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(summaryRows), 'Summary');

  const questionSheetRows = [['Section', 'Question #', 'Question', 'Expected Answer', 'Score', 'Remarks']];
  for (const section of DISPLAY_SECTIONS) {
    const items = section === 'follow_up' ? followUps : (panel[section] || []);
    items.forEach((item, index) => {
      const score = scoreMap?.[section]?.[String(index)] || {};
      questionSheetRows.push([
        section,
        index + 1,
        item.question || '',
        item.expected_answer || '',
        Number(score.score || 0),
        score.remarks || ''
      ]);
    });
  }
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(questionSheetRows), 'Questions & Scores');

  const scoreSummaryRows = [
    ['Section', 'Average Score', 'Weight'],
    ['Technical', scoreSummary.sectionAverages.technical, SECTION_WEIGHTS.technical],
    ['Practical', scoreSummary.sectionAverages.practical, SECTION_WEIGHTS.practical],
    ['Logic', scoreSummary.sectionAverages.logic, SECTION_WEIGHTS.logic],
    ['Behavioral', scoreSummary.sectionAverages.behavioral, SECTION_WEIGHTS.behavioral],
    ['Follow-up', scoreSummary.sectionAverages.follow_up, 0],
    ['Final Weighted Score', scoreSummary.finalScore, '']
  ];
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(scoreSummaryRows), 'Scoring');

  return workbook;
}

function buildInterviewPrintableHtml(interview, scoreRows) {
  const profile = interview.ai_profile_json?.candidate_profile || {};
  const panel = interview.ai_questions_json?.interview_panel || {};
  const followUps = interview.ai_questions_json?.follow_up_questions || [];
  const scoreMap = mapScoresBySection(scoreRows);
  const finalAi = interview.ai_final_json || {};
  const sections = DISPLAY_SECTIONS.map((section) => {
    const items = section === 'follow_up' ? followUps : (panel[section] || []);
    const rows = items.map((item, index) => {
      const score = scoreMap?.[section]?.[String(index)] || {};
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.question || '')}</td>
          <td>${escapeHtml(item.expected_answer || '')}</td>
          <td>${Number(score.score || 0)}</td>
          <td>${escapeHtml(score.remarks || '')}</td>
        </tr>
      `;
    }).join('');
    return `
      <section class="section">
        <h2>${escapeHtml(section.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()))}</h2>
        <table>
          <thead><tr><th>#</th><th>Question</th><th>Expected Answer</th><th>Score</th><th>Remarks</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">No questions generated.</td></tr>'}</tbody>
        </table>
      </section>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Interview Report - ${escapeHtml(interview.candidate_name || '-')}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
    h1, h2 { margin: 0 0 10px; }
    .meta, table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    .meta td, table td, table th { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
    table th { background: #eff6ff; text-align: left; }
    .hero { border: 2px solid #0f5c8f; padding: 18px; margin-bottom: 22px; }
    .company { font-size: 22px; font-weight: 800; letter-spacing: 0.08em; color: #0f5c8f; }
    .decision { font-weight: 800; color: #0f5c8f; }
    .section { margin-top: 22px; page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="company">JOYO PLASTICS</div>
    <div>AI Interview Panel Report</div>
    <table class="meta">
      <tr><td><strong>Candidate</strong></td><td>${escapeHtml(interview.candidate_name || profile.name || '-')}</td><td><strong>Role</strong></td><td>${escapeHtml(interview.applied_role || '-')}</td></tr>
      <tr><td><strong>Department</strong></td><td>${escapeHtml(interview.department || '-')}</td><td><strong>Recommended Role</strong></td><td>${escapeHtml(interview.recommended_role || interview.ai_questions_json?.recommended_role || '-')}</td></tr>
      <tr><td><strong>Experience</strong></td><td>${escapeHtml(profile.experience_level || '-')}</td><td><strong>Difficulty</strong></td><td>${escapeHtml(interview.difficulty_level || interview.ai_questions_json?.difficulty_level || 'medium')}</td></tr>
      <tr><td><strong>Final Score</strong></td><td>${Number(interview.final_score || 0)}</td><td><strong>Decision</strong></td><td class="decision">${escapeHtml(interview.result || finalAi.final_decision || 'Pending')}</td></tr>
      <tr><td><strong>Strengths</strong></td><td colspan="3">${escapeHtml((profile.strengths || []).join(', '))}</td></tr>
      <tr><td><strong>Weaknesses</strong></td><td colspan="3">${escapeHtml((profile.weaknesses || []).join(', '))}</td></tr>
      <tr><td><strong>Risk Flags</strong></td><td colspan="3">${escapeHtml((profile.risk_flags || []).join(', '))}</td></tr>
      <tr><td><strong>AI Justification</strong></td><td colspan="3">${escapeHtml(finalAi.justification || '')}</td></tr>
    </table>
  </div>
  ${sections}
</body>
</html>`;
}

module.exports = function registerInterviewPanelRoutes({ app, pool, config = {} }) {
  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, uploadRoot);
    },
    filename(_req, file, cb) {
      const safeName = (file.originalname || 'resume')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_');
      cb(null, `${Date.now()}_${safeName}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }
  });

  async function q(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
  }

  async function exec(text, params = []) {
    return pool.query(text, params);
  }

  async function ensureTables() {
    await exec(`
      CREATE TABLE IF NOT EXISTS hr_interviews (
        id SERIAL PRIMARY KEY,
        candidate_name TEXT NOT NULL,
        candidate_email TEXT,
        applied_role TEXT,
        department TEXT,
        resume_file_path TEXT,
        resume_file_name TEXT,
        resume_mime_type TEXT,
        resume_size INTEGER,
        resume_raw_text TEXT,
        resume_parsed_text TEXT,
        ai_profile_json JSONB DEFAULT '{}'::jsonb,
        ai_questions_json JSONB DEFAULT '{}'::jsonb,
        ai_final_json JSONB DEFAULT '{}'::jsonb,
        skill_match_score NUMERIC(10,2) DEFAULT 0,
        final_score NUMERIC(10,2) DEFAULT 0,
        confidence_score NUMERIC(10,2) DEFAULT 0,
        result TEXT DEFAULT 'Pending',
        recommended_role TEXT,
        difficulty_level TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'draft',
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_interview_scores (
        id SERIAL PRIMARY KEY,
        interview_id INTEGER NOT NULL REFERENCES hr_interviews(id) ON DELETE CASCADE,
        section TEXT NOT NULL,
        question_index INTEGER NOT NULL,
        score NUMERIC(10,2) DEFAULT 0,
        remarks TEXT,
        updated_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(interview_id, section, question_index)
      );
    `);

    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_interviews_created_at ON hr_interviews(created_at DESC)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_interviews_department ON hr_interviews(department)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_interview_scores_interview_section ON hr_interview_scores(interview_id, section)`);
  }

  ensureTables().catch((error) => {
    console.error('[Interview Panel] Failed to initialize tables:', error);
  });

  async function getSessionUser(req) {
    const username = getRequestUsername(req);
    if (!username) return null;
    return (await q(`
      SELECT id, username, role_code, line, global_access
        FROM users
       WHERE username = $1
       LIMIT 1
    `, [username]))[0] || null;
  }

  function isHrLike(user) {
    const role = String(user?.role_code || '').toLowerCase();
    return ROLE_ADMIN.has(role) || ROLE_HR.has(role);
  }

  async function requireHrAccess(req, res) {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return null;
    }
    if (!isHrLike(user)) {
      res.status(403).json({ ok: false, error: 'HR/Admin access required' });
      return null;
    }
    return user;
  }

  async function loadInterview(interviewId) {
    const interview = (await q(`SELECT * FROM hr_interviews WHERE id = $1 LIMIT 1`, [interviewId]))[0];
    if (!interview) return null;
    const scoreRows = await q(`
      SELECT id, interview_id, section, question_index, score, remarks, updated_by, updated_at
        FROM hr_interview_scores
       WHERE interview_id = $1
       ORDER BY section, question_index
    `, [interviewId]);
    const scoreSummary = computeInterviewScore(interview.ai_questions_json || {}, scoreRows);
    return {
      ...interview,
      scores: scoreRows,
      score_summary: scoreSummary
    };
  }

  async function buildDashboard() {
    const interviews = await q(`SELECT * FROM hr_interviews ORDER BY created_at DESC`);
    const total = interviews.length;
    const avgScore = total ? average(interviews.map((row) => row.final_score || 0)) : 0;
    const sorted = interviews.slice().sort((a, b) => Number(b.final_score || 0) - Number(a.final_score || 0));
    const topCandidates = sorted.slice(0, 5).map(buildInterviewListRow);
    const lowCandidates = sorted.slice(-5).reverse().map(buildInterviewListRow);

    const departments = new Map();
    const monthlyMap = new Map();
    for (const interview of interviews) {
      const department = interview.department || 'Unassigned';
      if (!departments.has(department)) {
        departments.set(department, { department, count: 0, totalScore: 0 });
      }
      const dept = departments.get(department);
      dept.count += 1;
      dept.totalScore += Number(interview.final_score || 0);

      const monthKey = String(interview.created_at).slice(0, 7);
      if (!monthlyMap.has(monthKey)) monthlyMap.set(monthKey, { month: monthKey, count: 0, totalScore: 0 });
      const month = monthlyMap.get(monthKey);
      month.count += 1;
      month.totalScore += Number(interview.final_score || 0);
    }

    return {
      total_interviews: total,
      average_score: avgScore,
      top_candidates: topCandidates,
      low_performers: lowCandidates,
      ranking: sorted.map(buildInterviewListRow),
      department_performance: [...departments.values()].map((dept) => ({
        department: dept.department,
        total_interviews: dept.count,
        average_score: Number((dept.totalScore / Math.max(dept.count, 1)).toFixed(2))
      })).sort((a, b) => b.average_score - a.average_score),
      monthly_trend: [...monthlyMap.values()].map((row) => ({
        month: row.month,
        average_score: Number((row.totalScore / Math.max(row.count, 1)).toFixed(2)),
        total_interviews: row.count
      })).sort((a, b) => a.month.localeCompare(b.month))
    };
  }

  app.get('/api/interview/meta', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const employees = await q(`
        SELECT p.user_id, p.full_name, p.employee_code, p.department, p.designation, p.role_code
          FROM hr_employee_profiles p
         WHERE COALESCE(p.is_active, TRUE) = TRUE
         ORDER BY p.full_name
      `);
      const departments = [...new Set(employees.map((row) => row.department).filter(Boolean))];
      res.json({
        ok: true,
        data: {
          current_user: user,
          departments,
          employees,
          model: aiModelName || 'Fallback Analyzer',
          section_weights: SECTION_WEIGHTS
        }
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/interview/list', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const rows = await q(`SELECT * FROM hr_interviews ORDER BY final_score DESC, skill_match_score DESC, created_at DESC`);
      res.json({ ok: true, data: rows.map(buildInterviewListRow) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/interview/dashboard', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      res.json({ ok: true, data: await buildDashboard() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/interview/upload', upload.single('resume'), async (req, res) => {
    const user = await requireHrAccess(req, res);
    if (!user) return;
    if (!req.file) return res.status(400).json({ ok: false, error: 'Resume file is required' });

    try {
      const candidateName = normalizeNullableText(req.body?.candidate_name);
      const candidateEmail = normalizeNullableText(req.body?.candidate_email);
      const appliedRole = normalizeNullableText(req.body?.applied_role);
      const department = normalizeNullableText(req.body?.department);
      const parsed = await parseResumeFile(req.file);
      const analysis = await analyzeResumeWithAi(config, parsed.parsedText || parsed.rawText, {
        candidate_name: candidateName,
        applied_role: appliedRole,
        department
      });

      const inserted = (await q(`
        INSERT INTO hr_interviews(
          candidate_name, candidate_email, applied_role, department,
          resume_file_path, resume_file_name, resume_mime_type, resume_size,
          resume_raw_text, resume_parsed_text,
          ai_profile_json, ai_questions_json,
          skill_match_score, recommended_role, difficulty_level,
          status, created_by, updated_at
        )
        VALUES(
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10,
          $11::jsonb, $12::jsonb,
          $13, $14, $15,
          'analyzed', $16, NOW()
        )
        RETURNING id
      `, [
        analysis.candidate_profile.name || candidateName || 'Unknown Candidate',
        candidateEmail,
        appliedRole,
        department,
        `/uploads/interviews/${path.basename(req.file.path)}`,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        parsed.rawText,
        parsed.parsedText,
        JSON.stringify(analysis.candidate_profile),
        JSON.stringify({
          interview_panel: analysis.interview_panel,
          follow_up_questions: analysis.follow_up_questions,
          recommended_role: analysis.recommended_role,
          difficulty_level: analysis.difficulty_level
        }),
        analysis.skill_match_score,
        analysis.recommended_role,
        analysis.difficulty_level,
        user.username
      ]))[0];

      const interview = await loadInterview(inserted.id);
      res.json({ ok: true, data: interview });
    } catch (error) {
      try {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (_cleanupError) {
        // Ignore cleanup errors.
      }
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/interview/:id', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const interviewId = Number(req.params.id);
      const interview = await loadInterview(interviewId);
      if (!interview) return res.status(404).json({ ok: false, error: 'Interview not found' });
      res.json({ ok: true, data: interview });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/interview/:id/score', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const interviewId = Number(req.params.id);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ ok: false, error: 'No scores provided' });

      const interview = await loadInterview(interviewId);
      if (!interview) return res.status(404).json({ ok: false, error: 'Interview not found' });

      for (const item of items) {
        const section = normalizeText(item.section).toLowerCase();
        const questionIndex = Number(item.question_index);
        const score = Number(item.score || 0);
        if (!DISPLAY_SECTIONS.includes(section)) continue;
        if (!Number.isFinite(questionIndex)) continue;
        await exec(`
          INSERT INTO hr_interview_scores(interview_id, section, question_index, score, remarks, updated_by, updated_at)
          VALUES($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT(interview_id, section, question_index)
          DO UPDATE SET
            score = EXCLUDED.score,
            remarks = EXCLUDED.remarks,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        `, [
          interviewId,
          section,
          questionIndex,
          score,
          normalizeNullableText(item.remarks),
          user.username
        ]);
      }

      const refreshed = await loadInterview(interviewId);
      await exec(`
        UPDATE hr_interviews
           SET final_score = $1,
               status = 'scored',
               updated_at = NOW()
         WHERE id = $2
      `, [refreshed.score_summary.finalScore, interviewId]);

      res.json({ ok: true, data: await loadInterview(interviewId) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/interview/:id/final-evaluate', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const interviewId = Number(req.params.id);
      const interview = await loadInterview(interviewId);
      if (!interview) return res.status(404).json({ ok: false, error: 'Interview not found' });

      const finalAi = await generateFinalEvaluation(config, interview, interview.score_summary);
      await exec(`
        UPDATE hr_interviews
           SET ai_final_json = $1::jsonb,
               result = $2,
               confidence_score = $3,
               final_score = $4,
               status = 'evaluated',
               updated_at = NOW()
         WHERE id = $5
      `, [
        JSON.stringify(finalAi),
        finalAi.final_decision,
        Number(finalAi.confidence_score || 0),
        Number(interview.score_summary.finalScore || 0),
        interviewId
      ]);

      res.json({ ok: true, data: await loadInterview(interviewId) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/interview/:id/export.xlsx', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const interviewId = Number(req.params.id);
      const interview = await loadInterview(interviewId);
      if (!interview) return res.status(404).json({ ok: false, error: 'Interview not found' });
      const workbook = buildInterviewExportWorkbook(interview, interview.scores || []);
      sendWorkbook(res, workbook, `joyo-plastics-interview-${interviewId}.xlsx`);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/interview/:id/export.pdf', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      const interviewId = Number(req.params.id);
      const interview = await loadInterview(interviewId);
      if (!interview) return res.status(404).json({ ok: false, error: 'Interview not found' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildInterviewPrintableHtml(interview, interview.scores || []));
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
};
