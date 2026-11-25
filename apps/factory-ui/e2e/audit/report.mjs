import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dialogs, screens } from './screens.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const md = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const image = file => file ? `<a href="screenshots/${escape(file)}"><img loading="lazy" src="screenshots/${escape(file)}" alt="${escape(file)}"></a>` : '';
const formatEvent = event => [event.type, event.status, event.path, event.text].filter(Boolean).join(' · ');
const levels = ['Chặn thao tác', 'Gây hiểu sai', 'Khó chịu', 'Thẩm mỹ'];
const criteria = Array.from({ length: 12 }, (_, index) => `C${index + 1}`);
const list = lines => `<ul>${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul>`;
const areas = { global: 'Toàn hệ thống', group: 'Group', project: 'Dự án' };
const retryNote = 'Liên kết sâu có thể bị chuyển về Tổng quan. Audit mở / để thiết lập phiên, mở lại hash đích và reload nếu vẫn bị chuyển hướng.';

function collectIssues(results) {
  const issues = [];
  const add = (level, where, message, file) => issues.push({ severity: levels[level], where, message, ...(file ? { file } : {}) });
  if (results.error) add(0, 'Audit', results.error);
  if (results.deepLink?.redirectedHome || results.deepLink?.retryNeeded) add(1, 'Deep link', retryNote, results.deepLink.file);
  for (const entry of results.seedFailures ?? []) add(0, 'Fixture', `${entry.type}: ${entry.error}`);
  for (const entry of results.captures) {
    const where = `${entry.id} · ${entry.width}px · ${entry.theme}`;
    if (entry.failure) add(0, where, entry.failure, entry.file);
    for (const message of entry.issues) {
      const level = /^(Từ tiếng Anh|UUID)/.test(message) ? 1 : /^(Tràn ngang|Nút không tên)/.test(message) ? 2 : 3;
      add(level, where, message, entry.file);
    }
    for (const event of entry.events) add(event.type === 'pageerror' || event.status >= 500 ? 0 : 2, where, formatEvent(event), entry.file);
  }
  for (const step of results.flows.filter(step => step.status === 'FAIL')) add(0, `${step.flow}/${step.name}`, step.error, step.file);
  for (const event of results.events) add(event.type === 'pageerror' || event.type === 'deep-link' || event.status >= 500 ? 0 : 2, event.phase ?? 'Host', formatEvent(event));
  return issues.sort((left, right) => levels.indexOf(left.severity) - levels.indexOf(right.severity));
}

export async function writeReport(root, results) {
  results.issues = collectIssues(results);
  await writeFile(join(root, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const thumbnails = Object.entries(areas).map(([area, name]) => {
    const entries = results.captures.filter(entry => entry.area === area);
    const groups = Map.groupBy(entries, entry => entry.id);
    return `<section><h2>${name}</h2>${[...groups].map(([id, entries]) => `<article><h3>${escape(id)}</h3><div class="cards">${entries.map(entry => `<figure>${image(entry.file)}<figcaption>${entry.width}px · ${escape(entry.theme)} · ${escape(entry.status)}</figcaption></figure>`).join('')}</div></article>`).join('') || '<p>CHƯA CHẠY</p>'}</section>`;
  }).join('');
  const crud = results.flows.map(step => `<tr><td>${escape(step.flow)}</td><td>${escape(step.name)}</td><td>${escape(step.status)}</td><td>${escape(step.expected)}</td><td>${escape(step.error)}${image(step.file)}</td></tr>`).join('');
  const issues = levels.map(level => {
    const entries = results.issues.filter(item => item.severity === level);
    return `<h3>${level} (${entries.length})</h3>${entries.length ? `<ul>${entries.map(item => `<li><strong>${escape(item.where)}</strong> · ${escape(item.message)} ${item.file ? `<a href="screenshots/${escape(item.file)}">Ảnh</a>` : ''}</li>`).join('')}</ul>` : '<p>—</p>'}`;
  }).join('');
  const deepLink = results.deepLink;
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Factory UI · R-1 audit</title><style>
  body{font:15px system-ui;margin:24px;background:#f5f5f5;color:#222}main{max-width:1440px;margin:auto}section{background:white;padding:16px;margin:12px 0;border-radius:8px;overflow:auto}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}figure{margin:0}img{width:100%;height:auto;border:1px solid #ddd}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}td img{max-width:240px}li,td{overflow-wrap:anywhere}
  </style><main><h1>Factory UI · R-1 audit</h1><p>${escape(results.status)} · ${escape(results.generatedAt)}</p>
  <section><h2>CRUD</h2>${crud ? `<table><thead><tr><th>Luồng</th><th>Bước</th><th>Trạng thái</th><th>Mong đợi</th><th>Bằng chứng</th></tr></thead><tbody>${crud}</tbody></table>` : '<p>CHƯA CHẠY</p>'}</section>
  <section><h2>Phát hiện ưu tiên</h2>${issues}</section>
  <section><h2>Liên kết sâu</h2><p>${retryNote}</p>${deepLink ? `${list([`Đích: ${deepLink.hash}`, `Lần đầu: ${deepLink.actual}`, `Khôi phục: ${deepLink.recovered ? 'OK' : 'Không xác nhận'}`, `Reload cần thiết: ${deepLink.retryNeeded === undefined ? 'Không xác nhận' : deepLink.retryNeeded ? 'Có' : 'Không'}`])}${image(deepLink.file)}` : '<p>CHƯA CHẠY</p>'}</section>
  ${thumbnails}</main></html>`;
  await writeFile(join(root, 'report.html'), html);
}

export async function writeFindings(path, results) {
  const rows = [...screens, ...dialogs].map(({ id, screen }) => {
    const captured = results.captures.filter(entry => entry.id === id && entry.inspection);
    const first = captured[0];
    const cells = criteria.map(key => {
      const rule = { C9: 'accessibility', C10: 'overflow', C11: 'language' }[key];
      const failed = rule && captured.find(entry => entry.flags.includes(rule));
      if (failed) return `✖ ${failed.file ?? 'Không có ảnh'}`;
      if (key === 'C1' && screen && first) return `✔ ${first.file ?? 'Đã mở'}`;
      return '—';
    });
    return `| ${id} | ${cells.join(' | ')} | ${first ? `${first.file ?? 'Không có ảnh'}; ${captured.length}/4 cấu hình.` : 'Chưa có ảnh.'} |`;
  });
  const lines = [
    '# R-1 · Rà soát giao diện', '', `Trạng thái: **${results.status}**.`, '', retryNote, '',
    '## Ma trận màn hình × C1–C12', '',
    '✔ / ✖ chỉ áp dụng cho phần quan sát được; — là chưa đủ bằng chứng (bao gồm WCAG AA và toàn bộ hành vi bàn phím).', '',
    `| Màn hình / hộp thoại | ${criteria.join(' | ')} | Bằng chứng |`,
    `| --- | ${criteria.map(() => '---').join(' | ')} | --- |`, ...rows, '', '## Phát hiện ưu tiên', '',
    ...(results.issues.length ? results.issues.map(item => `- **${item.severity} — ${md(item.where)}:** ${md(item.message)}${item.file ? ` · ${item.file}` : ''}`) : ['Chưa có phát hiện được xác nhận.']), '',
    'Ảnh, bước CRUD và dữ liệu gốc: `apps/factory-ui/.audit/`.', '',
  ];
  await writeFile(path, lines.join('\n'));
}
