const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'ys_log.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 数据库实例
let db;
let saveTimer = null;

// 保存数据库到文件（防抖，避免频繁写入）
function saveDb() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('保存数据库失败:', e.message);
    }
  }, 500);
}

// 立即保存（用于关键操作后）
function saveDbNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('保存数据库失败:', e.message);
  }
}

// 工具函数
function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

function all(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params) {
  db.run(sql, params);
  saveDb();
}

function get(sql, params) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ========== 要事日志 API ==========
app.get('/api/logs', (req, res) => {
  const { recorder, dateFrom, dateTo, keyword, page = 1, pageSize = 10 } = req.query;
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const params = [];
  if (recorder) { sql += ' AND recorder = ?'; params.push(recorder); }
  if (dateFrom) { sql += ' AND date >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND date <= ?'; params.push(dateTo); }
  if (keyword) { sql += ' AND (title LIKE ? OR content LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%'); }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const totalRow = get(countSql, params.length ? params : undefined);
  const total = totalRow ? totalRow.total : 0;

  sql += ' ORDER BY date DESC, createTime DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const rows = all(sql, params);
  res.json({ total, page: Number(page), pageSize: Number(pageSize), data: rows });
});

app.post('/api/logs', (req, res) => {
  const { id, date, recorder, title, content, remark } = req.body;
  const logId = id || genId();
  run('INSERT INTO logs (id, date, recorder, title, content, remark) VALUES (?, ?, ?, ?, ?, ?)',
    [logId, date, recorder || '', title, content || '', remark || '']);
  res.json({ id: logId, ok: true });
});

app.put('/api/logs/:id', (req, res) => {
  const { date, recorder, title, content, remark } = req.body;
  run('UPDATE logs SET date=?, recorder=?, title=?, content=?, remark=? WHERE id=?',
    [date, recorder || '', title, content || '', remark || '', req.params.id]);
  res.json({ ok: true });
});

app.get('/api/logs/:id', (req, res) => {
  const row = get('SELECT * FROM logs WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json(row);
});

app.delete('/api/logs/:id', (req, res) => {
  run('DELETE FROM logs WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ========== 大事记 API ==========
app.get('/api/events', (req, res) => {
  const { office, dateFrom, dateTo, keyword, page = 1, pageSize = 10 } = req.query;
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (office) {
    sql += ' AND (office = ? OR office LIKE ? OR office LIKE ? OR office LIKE ?)';
    params.push(office, office + '、%', '%、' + office, '%、' + office + '、%');
  }
  if (dateFrom) { sql += ' AND date >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND date <= ?'; params.push(dateTo); }
  if (keyword) { sql += ' AND (title LIKE ? OR content LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%'); }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const totalRow = get(countSql, params.length ? params : undefined);
  const total = totalRow ? totalRow.total : 0;

  sql += ' ORDER BY date DESC, createTime DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const rows = all(sql, params);
  res.json({ total, page: Number(page), pageSize: Number(pageSize), data: rows });
});

app.post('/api/events', (req, res) => {
  const { id, date, office, title, content } = req.body;
  const eventId = id || genId();
  run('INSERT INTO events (id, date, office, title, content) VALUES (?, ?, ?, ?, ?)',
    [eventId, date, office || '', title, content || '']);
  res.json({ id: eventId, ok: true });
});

app.put('/api/events/:id', (req, res) => {
  const { date, office, title, content } = req.body;
  run('UPDATE events SET date=?, office=?, title=?, content=? WHERE id=?',
    [date, office || '', title, content || '', req.params.id]);
  res.json({ ok: true });
});

app.get('/api/events/:id', (req, res) => {
  const row = get('SELECT * FROM events WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json(row);
});

app.delete('/api/events/:id', (req, res) => {
  run('DELETE FROM events WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ========== 承办处室 API ==========
app.get('/api/offices', (req, res) => {
  const rows = all('SELECT * FROM offices ORDER BY sortOrder ASC, id ASC');
  res.json(rows);
});

app.post('/api/offices', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '处室名称不能为空' });
  const existing = get('SELECT id FROM offices WHERE name = ?', [name]);
  if (existing) return res.status(400).json({ error: '处室名称已存在' });
  const id = genId();
  const maxOrderRow = get('SELECT MAX(sortOrder) as m FROM offices');
  const maxOrder = (maxOrderRow && maxOrderRow.m) || 0;
  run('INSERT INTO offices (id, name, sortOrder) VALUES (?, ?, ?)', [id, name, maxOrder + 1]);
  res.json({ id, ok: true });
});

app.put('/api/offices/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '处室名称不能为空' });
  run('UPDATE offices SET name=? WHERE id=?', [name, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/offices/:id', (req, res) => {
  run('DELETE FROM offices WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/offices', (req, res) => {
  run('DELETE FROM offices');
  res.json({ ok: true });
});

app.put('/api/offices/reorder', (req, res) => {
  const { ids } = req.body;
  ids.forEach((id, idx) => {
    run('UPDATE offices SET sortOrder=? WHERE id=?', [idx + 1, id]);
  });
  saveDbNow();
  res.json({ ok: true });
});

// ========== 录入人员 API ==========
app.get('/api/persons', (req, res) => {
  const rows = all('SELECT * FROM persons ORDER BY id ASC');
  res.json(rows);
});

app.post('/api/persons', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '人员姓名不能为空' });
  const existing = get('SELECT id FROM persons WHERE name = ?', [name]);
  if (existing) return res.status(400).json({ error: '人员姓名已存在' });
  const id = genId();
  run('INSERT INTO persons (id, name) VALUES (?, ?)', [id, name]);
  res.json({ id, ok: true });
});

app.put('/api/persons/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '人员姓名不能为空' });
  run('UPDATE persons SET name=? WHERE id=?', [name, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/persons/:id', (req, res) => {
  run('DELETE FROM persons WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ========== 统计 API ==========
app.get('/api/stats', (req, res) => {
  const logCount = get('SELECT COUNT(*) as c FROM logs').c;
  const eventCount = get('SELECT COUNT(*) as c FROM events').c;
  const officeCount = get('SELECT COUNT(*) as c FROM offices').c;
  const personCount = get('SELECT COUNT(*) as c FROM persons').c;
  res.json({ logCount, eventCount, officeCount, personCount });
});

// ========== 数据备份 API ==========
app.get('/api/backup', (req, res) => {
  const logs = all('SELECT * FROM logs ORDER BY date DESC, createTime DESC');
  const events = all('SELECT * FROM events ORDER BY date DESC, createTime DESC');
  const offices = all('SELECT * FROM offices ORDER BY sortOrder ASC, id ASC');
  const persons = all('SELECT * FROM persons ORDER BY id ASC');
  res.json({
    version: '1.0',
    exportTime: new Date().toISOString(),
    logs, events, offices, persons
  });
});

// ========== 数据恢复 API ==========
app.post('/api/restore', (req, res) => {
  const { logs, events, offices, persons } = req.body;
  if (!logs && !events && !offices && !persons) {
    return res.status(400).json({ error: '备份数据为空' });
  }

  // 清空现有数据
  run('DELETE FROM logs');
  run('DELETE FROM events');
  run('DELETE FROM offices');
  run('DELETE FROM persons');
  run("DELETE FROM meta WHERE key='seeded'");

  // 恢复处室
  if (offices && offices.length) {
    offices.forEach(o => {
      run('INSERT OR IGNORE INTO offices (id, name, sortOrder) VALUES (?, ?, ?)',
        [o.id, o.name, o.sortOrder || 0]);
    });
  }

  // 恢复人员
  if (persons && persons.length) {
    persons.forEach(p => {
      run('INSERT OR IGNORE INTO persons (id, name) VALUES (?, ?)',
        [p.id, p.name]);
    });
  }

  // 恢复要事日志
  if (logs && logs.length) {
    logs.forEach(l => {
      run('INSERT OR IGNORE INTO logs (id, date, recorder, title, content, remark, createTime) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [l.id, l.date, l.recorder || '', l.title, l.content || '', l.remark || '', l.createTime || '']);
    });
  }

  // 恢复大事记
  if (events && events.length) {
    events.forEach(e => {
      run('INSERT OR IGNORE INTO events (id, date, office, title, content, createTime) VALUES (?, ?, ?, ?, ?, ?)',
        [e.id, e.date, e.office || '', e.title, e.content || '', e.createTime || '']);
    });
  }

  // 标记为已初始化
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', '1')");
  saveDbNow();
  res.json({ ok: true, message: '数据恢复成功', logCount: logs ? logs.length : 0, eventCount: events ? events.length : 0 });
});

// ========== 种子数据 ==========
app.post('/api/seed', (req, res) => {
  const seeded = get("SELECT value FROM meta WHERE key='seeded'");
  if (seeded) return res.json({ ok: true, message: '已初始化' });

  // 默认处室
  const defaultOffices = ['院务办公室','党委办公室','教学科研培训处','中华文化工作处','人事处','总务处'];
  defaultOffices.forEach((name, idx) => {
    const existing = get('SELECT id FROM offices WHERE name=?', [name]);
    if (!existing) run('INSERT INTO offices (id, name, sortOrder) VALUES (?, ?, ?)', [genId(), name, idx + 1]);
  });

  // 默认人员
  ['郝栋','白源'].forEach(name => {
    const existing = get('SELECT id FROM persons WHERE name=?', [name]);
    if (!existing) run('INSERT INTO persons (id, name) VALUES (?, ?)', [genId(), name]);
  });

  // 郝栋10条
  const haoTitles = ['整理归档本月文件材料','完成季度工作总结撰写','更新学院网站信息发布','协调安排下周会议日程','对接上级部门工作对接','报送统战工作统计数据','审核培训班学员名单','准备教学评估相关材料','组织部门业务学习活动','落实安全检查整改事项'];
  const haoContents = ['对本月收发的各类文件进行了分类整理和归档，确保档案完整规范。','按照上级要求，完成了本季度工作总结的撰写，涵盖重点工作进展和下一步计划。','及时更新了学院官方网站的通知公告和新闻动态栏目，确保信息发布时效性。','与各部门沟通确认下周会议安排，编制了会议日程表并下发通知。','就年度考核事项与省委统战部进行了工作对接，明确了相关要求。','按照统一部署，完成了本季度统战工作统计数据的收集、审核和上报。','对下期培训班报名学员信息进行了逐一核实，确认了最终参训名单。','根据教学评估指标体系，整理汇总了相关支撑材料并提交审核。','组织本部门人员集中学习了最新政策文件，结合实际工作进行了讨论。','针对前期安全检查发现的问题，逐项落实了整改措施并完成复查。'];
  const haoRemarks = ['','需后续跟踪','已归档','待确认','优先处理','','已反馈','','跟进中',''];
  for (let i = 0; i < 10; i++) {
    const d = '2026-05-' + String(i + 1).padStart(2, '0');
    run('INSERT INTO logs (id, date, recorder, title, content, remark) VALUES (?, ?, ?, ?, ?, ?)',
      [genId(), d, '郝栋', haoTitles[i], haoContents[i], haoRemarks[i] || '']);
  }

  // 白源10条
  const baiTitles = ['编制年度经费预算方案','联系协调培训班师资','起草学院工作要点','审核教学课程安排','组织学员报到注册','汇总月度考勤记录','准备院务会议材料','对接兄弟学院交流','整理图书资料编目','完成信息报送任务'];
  const baiContents = ['根据上年度经费执行情况，编制了本年度经费预算方案并提交审批。','就下期培训班师资事宜与相关专家进行了联系协调，确认了授课安排。','按照院领导指示，起草了学院年度工作要点，明确了重点任务分工。','对下学期教学课程安排进行了审核，确保课程设置合理规范。','组织完成了新一期培训学员的报到注册工作，发放了学习资料。','汇总了本月全体人员考勤记录，核实后报人事部门备案。','根据院务会议议程，准备了相关汇报材料和讨论议题。','与兄弟社会主义学院就干部培训合作事项进行了沟通对接。','对图书馆新增图书资料进行了分类编目，完善了检索目录。','按照信息报送要求，完成了本月工作信息的撰写和上报。'];
  const baiRemarks = ['待审批','已确认','审核中','','已完成','','待讨论','进行中','已编目','已报送'];
  for (let i = 0; i < 10; i++) {
    const d = '2026-05-' + String(i + 1).padStart(2, '0');
    run('INSERT INTO logs (id, date, recorder, title, content, remark) VALUES (?, ?, ?, ?, ?, ?)',
      [genId(), d, '白源', baiTitles[i], baiContents[i], baiRemarks[i] || '']);
  }

  // 10条大事记
  const evtTitles = ['举办2026年春季开学典礼','召开院务工作会议','开展统战理论研讨','组织学员社会实践','举办专题讲座','推进信息化建设','完成教学评估自查','召开民主生活会','组织红色教育活动','举办结业典礼'];
  const evtContents = ['学院隆重举行2026年春季学期开学典礼，省委统战部领导出席并讲话。','召开院务工作会议，研究部署本学期重点工作任务。','围绕新时代统战工作理论创新开展专题研讨，形成研究成果。','组织学员赴基层开展社会实践活动，深入了解社情民意。','邀请知名专家举办统战工作专题讲座，取得良好效果。','启动学院信息化建设二期工程，推进智慧校园建设。','按照评估指标体系完成教学评估自查工作，形成自查报告。','按照组织要求召开民主生活会，开展批评与自我批评。','组织教职工和学员赴革命教育基地开展红色教育活动。','圆满完成本学期培训任务，举行结业典礼并颁发证书。'];
  const evtOffices = ['院务办公室','院务办公室、党委办公室','教学科研培训处','中华文化工作处','党委办公室、教学科研培训处','院务办公室','教学科研培训处','院务办公室','中华文化工作处、人事处','教学科研培训处、总务处'];
  for (let i = 0; i < 10; i++) {
    const d = '2026-05-' + String(i + 1).padStart(2, '0');
    run('INSERT INTO events (id, date, office, title, content) VALUES (?, ?, ?, ?, ?)',
      [genId(), d, evtOffices[i], evtTitles[i], evtContents[i]]);
  }

  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', '1')");
  saveDbNow();
  res.json({ ok: true, message: '种子数据已初始化' });
});

// SPA 回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动
async function start() {
  const SQL = await initSqlJs();

  // 尝试加载已有数据库
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('已加载数据库:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('创建新数据库');
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      recorder TEXT,
      title TEXT NOT NULL,
      content TEXT,
      remark TEXT,
      createTime TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
    CREATE INDEX IF NOT EXISTS idx_logs_recorder ON logs(recorder);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      office TEXT,
      title TEXT NOT NULL,
      content TEXT,
      createTime TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

    CREATE TABLE IF NOT EXISTS offices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sortOrder INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  saveDbNow();

  app.listen(PORT, () => {
    console.log(`要事日志系统已启动: http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
