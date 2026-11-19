import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checklist, screens, dialogs } from './screens.mjs';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const image = file => file ? `<a href="screenshots/${escape(file)}"><img loading="lazy" src="screenshots/${escape(file)}" alt="${escape(file)}"></a>` : '';
const list = items => `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('') || '<li>Không ghi nhận.</li>'}</ul>`;

export async function writeReport(root, results) {
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2));
  const cards = results.captures.map(entry => `<article><h3>${escape(entry.id)} · ${entry.width}px · ${escape(entry.theme)}</h3>${image(entry.file)}${list([...entry.issues, ...entry.events.map(formatEvent)])}</article>`).join('');
  const flows = results.flows.map(step => `<li><strong>${escape(step.flow)} · ${escape(step.name)} · ${escape(step.status)}</strong> — Mong đợi: ${escape(step.expected)}${step.error ? `<p>${escape(step.error)}</p>` : ''}${image(step.file)}</li>`).join('');
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Factory UI · R-0</title><style>body{font:15px system-ui;margin:24px;background:#f5f5f5;color:#222}main{max-width:1440px;margin:auto}section,article{background:white;padding:16px;margin:12px 0;border-radius:8px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}img{width:100%;height:auto;border:1px solid #ddd}li img{max-width:320px}li{overflow-wrap:anywhere}</style><main><h1>Factory UI · R-0 audit</h1><p>${escape(results.status)} · ${escape(results.generatedAt)}</p>${results.error ? `<p>${escape(results.error)}</p>` : ''}<section><h2>CRUD</h2>${flows.length ? `<ol>${flows}</ol>` : '<p>CHƯA CHẠY</p>'}</section><section><h2>Màn hình và hộp thoại</h2><div class="cards">${cards || '<p>CHƯA CHẠY</p>'}</div></section><section><h2>Lần tải đầu từ liên kết sâu</h2>${results.deepLink ? `<p>${escape(results.deepLink.result)}</p>${image(results.deepLink.file)}` : '<p>CHƯA CHẠY</p>'}</section><section><h2>Telemetry ngoài lượt chụp</h2>${list(results.events.filter(event => !event.capture).map(formatEvent))}</section></main></html>`;
  await writeFile(join(root, 'report.html'), html);
}

const formatEvent = event => [event.type, event.status, event.path, event.text].filter(Boolean).join(' · ');
const md = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

export async function writeFindings(path, results) {
  const entries = [...screens, ...dialogs];
  const rows = entries.map(({ id, screen }) => {
    const captured = results.captures.filter(entry => entry.id === id && entry.inspection);
    const first = captured[0];
    const cells = checklist.map(([key]) => {
      const rule = { C9: 'accessibility', C10: 'overflow', C11: 'language' }[key];
      const failed = rule && captured.find(entry => entry.flags.includes(rule));
      if (failed) return `✖ Ảnh ${failed.file}`;
      if (key === 'C1' && screen && first) return `✔ Mở được: ${first.file}`;
      return '—';
    });
    return `| ${id} | ${cells.join(' | ')} | ${first ? `Ảnh ${first.file}; ${captured.length}/4 cấu hình.` : 'Chưa có ảnh.'} |`;
  });
  const findings = [];
  if (results.deepLink?.redirectedHome) findings.push(`- **Gây hiểu sai — Agent & Đội:** mở liên kết tab trong ngữ cảnh mới. Kết quả: về Tổng quan. Mong đợi: giữ tab được liên kết. Ảnh: ${results.deepLink.file}.`);
  for (const [flag, priority, description, expected] of [
    ['overflow', 'Khó chịu', 'Tiêu đề hoặc thanh công cụ tràn ngang', 'Các hành động vẫn đọc được hoặc có chỉ dẫn cuộn'],
    ['language', 'Gây hiểu sai', 'Có từ tiếng Anh hoặc mã UUID trong văn bản hiển thị', 'Dùng nhãn tiếng Việt và tên dễ nhận biết'],
    ['accessibility', 'Khó chịu', 'Có nút không tên hoặc ảnh không có thuộc tính alt', 'Gắn tên truy cập hoặc đánh dấu là trang trí'],
    ['grid', 'Thẩm mỹ', 'Các nút chưa có tọa độ được bố trí thành lưới', 'Tự bố trí theo hướng luồng khi chưa lưu vị trí'],
    ['select', 'Thẩm mỹ', 'Có ô chọn gốc', 'Dùng thành phần chọn nhất quán'],
  ]) {
    const matching = new Map();
    for (const entry of results.captures.filter(item => item.flags.includes(flag))) matching.set(entry.id, entry);
    for (const entry of matching.values()) findings.push(`- **${priority} — ${entry.id}:** mở màn hình ở ${entry.width}px (${entry.theme}). Kết quả: ${description}. Mong đợi: ${expected}. Ảnh: ${entry.file}.`);
  }
  const lines = [
    '# R-0 · Rà soát giao diện', '', `Trạng thái: **${results.status}**.`,
    ...(results.error ? ['', `Giới hạn lần chạy: ${md(results.error)}`] : []), '',
    '## Ma trận màn hình × C1–C12', '',
    '✔ / ✖ chỉ áp dụng cho phần quan sát được; — là chưa đủ bằng chứng. Kiểm tra tự động không xác nhận WCAG AA hay toàn bộ hành vi bàn phím.', '',
    `| Màn hình / hộp thoại | ${checklist.map(([key]) => key).join(' | ')} | Bằng chứng |`,
    `| --- | ${checklist.map(() => '---').join(' | ')} | --- |`, ...rows, '',
    '## Phát hiện ưu tiên', '',
    ...(findings.length ? findings.sort((left, right) => priorityOf(left) - priorityOf(right)) : ['Chưa có phát hiện được xác nhận.']), '',
    'Ảnh, bước CRUD và dữ liệu gốc: `apps/factory-ui/.audit/`.', '',
  ];
  await writeFile(path, lines.join('\n'));
}

function priorityOf(line) {
  return ['Chặn thao tác', 'Gây hiểu sai', 'Khó chịu', 'Thẩm mỹ'].findIndex(priority => line.startsWith(`- **${priority}`));
}
