import { Activity, ArrowDown, ArrowRight, Blocks, Check, ChevronRight, FolderTree, GitBranch, GitPullRequest, Laptop, MessageCircle, Network, Play, Settings2, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { CodeBlock, External, Mochi, Screenshot, demo, repo, text, type Lang } from './shared';

const features = [
  [Laptop, 'Local-first', 'Local-first', 'Host và SQLite chạy trên máy bạn. Mặc định chỉ nghe trên loopback.', 'The Host and SQLite run on your machine. Loopback only by default.', 'peach'],
  [Network, 'Agent & Team là dữ liệu', 'Agents and teams as data', 'Đổi vai trò, model, skill và quan hệ phản biện theo từng dự án.', 'Change roles, models, skills and review relationships per project.', 'mint'],
  [Workflow, 'Workflow có trạng thái', 'A stateful workflow engine', 'Vẽ trên canvas; lưu version, tạm dừng và tiếp tục từ trạng thái đã lưu.', 'Build on a canvas, version definitions, pause and resume from saved state.', 'blue'],
  [MessageCircle, 'Bàn → Chốt → Làm', 'Discuss → Decide → Run', 'Lead nghe trước, viết Bản chốt sau khi bạn xác nhận, rồi mới khởi chạy.', 'The Lead listens first, writes a brief after you agree, then starts the workflow.', 'peach'],
  [ShieldCheck, 'Phê duyệt & chính sách', 'Approvals & policies', 'Giới hạn tool và ngân sách; giữ quyền quyết định ở các bước quan trọng.', 'Limit tools and budgets; retain control over consequential decisions.', 'mint'],
  [Activity, 'Trace & Hiệu quả', 'Trace & Insights', 'Xem bằng chứng từ request đến artifact. Dùng Insights để đề xuất Draft.', 'Follow evidence from request to artifact. Use Insights to propose a Draft.', 'blue'],
  [FolderTree, 'Group lồng nhau', 'Nested groups', 'Tổ chức dự án, dùng chung Thư viện, kế thừa mặc định và chia sẻ ngân sách.', 'Organize projects, share a library, inherit defaults and share budgets.', 'peach'],
  [Blocks, 'Extension tùy chọn', 'Opt-in extensions', 'Nhập pack theo nhu cầu, từ team phần mềm đến xưởng Web Games.', 'Import the packs you need, from software teams to the Web Games studio.', 'mint'],
] as const;

const steps = [
  [MessageCircle, 'Bạn ↔ Lead chat', 'You ↔ Lead chat', 'Bàn mục tiêu', 'Discuss the goal'],
  [Check, 'Bản chốt', 'Decision brief', 'Bạn chốt phương án', 'You confirm the plan'],
  [Workflow, 'Workflow', 'Workflow', 'Chạy đúng version', 'Run the right version'],
  [GitBranch, 'Agent trong worktree', 'Agents in worktrees', 'Cô lập thay đổi mã', 'Isolate code changes'],
  [GitPullRequest, 'Review / QA', 'Review / QA', 'Kiểm tra bằng chứng', 'Check the evidence'],
  [ShieldCheck, 'Bạn duyệt', 'Your approval', 'Quyết định tiếp hay dừng', 'Decide whether to proceed'],
  [ArrowRight, 'Publish', 'Publish', 'Khi workflow có bước này', 'If the workflow includes it'],
] as const;

const roles = [
  ['LEAD', 'Game Lead', 'Chốt hướng đi', 'Agree on direction'], ['BA', 'Game Designer', 'Thiết kế lối chơi', 'Design the gameplay'],
  ['BE', 'Rules Engineer', 'Luật, bot và test', 'Rules, bots and tests'], ['FE', 'Client Engineer', 'Client, SDK và nhập liệu', 'Client, SDK and input'],
  ['PLUM', 'UI Artist', 'CSS, SVG và thumbnail', 'CSS, SVG and thumbnails'], ['TEST', 'QA Engineer', 'Chơi thử và kiểm hồi quy', 'Playtest and check regressions'],
  ['MINT', 'Code Reviewer', 'Phản biện diff', 'Review the diff'], ['DEVOPS', 'Release Manager', 'Kiểm trước phát hành', 'Check before release'],
] as const;

const gameSteps = [
  ['Thiết kế & đối chiếu brief', 'Design & brief check'], ['Luật, art & client qua review', 'Rules, art & client through review'],
  ['QA & sửa có giới hạn', 'QA & bounded repair'], ['Kiểm tra phát hành', 'Release checks'], ['Duyệt → Publish lên Portal', 'Approve → Publish to Portal'],
] as const;

const comparisons = [
  ['Từ ý định đến thực thi', 'From intent to execution', 'Bản chốt có version ghi lại điều đã thống nhất, trước khi agent bắt tay làm.', 'A versioned brief captures what you agreed before agents start work.'],
  ['Một run có thể kiểm tra lại', 'A run you can inspect', 'Workflow lưu version và trạng thái; Trace nối node, task, attempt, tool call và artifact.', 'Workflows keep versions and state; Trace connects nodes, tasks, attempts, tool calls and artifacts.'],
  ['Bạn giữ quyền quyết định', 'You keep the final say', 'Bạn chọn runtime, chính sách và bước cần duyệt. Kết quả external effect chưa rõ phải được đối soát.', 'You choose runtimes, policies and approval gates. Unclear external effects must be reconciled.'],
] as const;

const install = `git clone ${repo}.git factory
cd factory
bash scripts/install.sh --yes
export PATH="$HOME/.local/bin:$PATH"
factory setup
factory doctor
factory start`;

export function Landing({ lang }: { lang: Lang }) {
  return <>
    <section className="hero">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow hero-badge"><span />{text(lang, 'LOCAL-FIRST · MÃ NGUỒN MỞ', 'LOCAL-FIRST · OPEN SOURCE')}</p>
          <h1>{text(lang, 'Đội AI của bạn.', 'Your AI team.')}<br /><em>{text(lang, 'Trên máy của bạn.', 'On your machine.')}</em></h1>
          <p className="hero-description">{text(lang, 'Bàn với Lead, chốt phương án, rồi để các agent phối hợp trong một workflow mà bạn theo dõi và kiểm soát.', 'Talk with your Lead, agree on a plan, then let agents work together in a workflow you can see and control.')}</p>
          <div className="actions"><a className="button primary" href="#/try"><Play size={17} aria-hidden="true" />{text(lang, 'Dùng thử Factory', 'Try Factory')}</a><a className="button secondary" href="#/docs/introduction">{text(lang, 'Đọc tài liệu', 'Read the docs')}<ArrowRight size={17} aria-hidden="true" /></a></div>
          <p className="hero-note"><span aria-hidden="true">✦</span> {text(lang, 'Chạy trên máy bạn · Git worktree · Giấy phép MIT', 'Runs locally · Git worktrees · MIT licensed')}</p>
        </div>
        <div className="hero-visual">
          <Screenshot key={`hero-${lang}`} name="workflow" caption="Workflow" lang={lang} hero />
          <div className="hero-stamp"><Mochi /><span>{text(lang, 'Bàn → Chốt → Làm', 'Discuss → Decide → Run')}</span></div>
          <Mochi role="FE" className="hero-sidekick" />
        </div>
      </div>
    </section>

    <section className="section wrap" id="features">
      <p className="eyebrow">01 / {text(lang, 'Tính năng', 'Features')}</p>
      <h2>{text(lang, 'Một nơi để cả đội làm việc', 'One place for the whole team')}</h2>
      <p className="section-intro">{text(lang, 'Cấu hình đội trong giao diện, điều phối công việc bằng workflow, và quyết định ở những bước cần con người.', 'Configure the team in the UI, coordinate with workflows and make the decisions that need a human.')}</p>
      <div className="feature-grid">{features.map(([Icon, vi, en, bodyVi, bodyEn, tint]) => <article className="tile" key={en}>
        <span className={`tile-icon ${tint}`}><Icon size={22} aria-hidden="true" /></span><h3>{text(lang, vi, en)}</h3><p>{text(lang, bodyVi, bodyEn)}</p>
      </article>)}</div>
    </section>

    <section className="workflow-section" id="how">
      <div className="section wrap">
        <p className="eyebrow">02 / {text(lang, 'Cách hoạt động', 'How it works')}</p>
        <h2>{text(lang, 'Chốt trước. Chạy sau.', 'Agree first. Run second.')}</h2>
        <p className="section-intro">{text(lang, 'Lead đề xuất, Host kiểm tra, và bạn giữ quyền duyệt. Đây là một luồng điển hình cho công việc có bước publish.', 'The Lead proposes, the Host validates, and you keep approval authority. This is a typical path for work with a publish step.')}</p>
        <ol className="flow-diagram">{steps.map(([Icon, vi, en, bodyVi, bodyEn], index) => <li key={en}>
          <Icon size={22} aria-hidden="true" /><strong>{text(lang, vi, en)}</strong><span>{text(lang, bodyVi, bodyEn)}</span>
          {index < steps.length - 1 && <><ChevronRight className="step-arrow" size={15} aria-hidden="true" /><ArrowDown className="step-down" size={15} aria-hidden="true" /></>}
        </li>)}</ol>
        <div className="screens-grid">{[
          ['office', 'Văn phòng', 'Office'], ['agents', 'Agent & Team', 'Agents & Teams'], ['lead-chat', 'Lead chat', 'Lead chat'], ['trace', 'Trace', 'Trace'],
        ].map(([name, vi, en]) => <Screenshot key={`${name}-${lang}`} name={name} caption={text(lang, vi, en)} lang={lang} />)}</div>
      </div>
    </section>

    <section className="section wrap" id="game-team">
      <p className="eyebrow">03 / {text(lang, 'Đội làm game', 'Game team')}</p>
      <h2>{text(lang, 'Một xưởng game, tám vai trò', 'One game studio, eight roles')}</h2>
      <p className="section-intro">{text(lang, 'Web Games là một pack tùy chọn để làm game trình duyệt theo lượt. Đội làm việc từ starter; Portal nhận bản build sau khi bạn duyệt.', 'Web Games is an opt-in pack for turn-based browser games. The team builds on a starter; Portal receives the build after your approval.')}</p>
      <div className="roster">{roles.map(([role, name, vi, en]) => <article key={role}><Mochi role={role} /><h3>{name}</h3><p>{text(lang, vi, en)}</p></article>)}</div>
      <div className="game-flow"><div><span className="eyebrow">Workflow</span><h3><code>game-new</code></h3></div><ol>{gameSteps.map(([vi, en]) => <li key={en}>{text(lang, vi, en)}</li>)}</ol><a className="text-link" href="#/docs/web-games">{text(lang, 'Xem hướng dẫn Portal', 'Read the Portal guide')}<ArrowRight size={16} aria-hidden="true" /></a></div>
    </section>

    <section className="why-section"><div className="section wrap why-grid">
      <div><p className="eyebrow">04 / {text(lang, 'Vì sao Factory', 'Why Factory')}</p><h2>{text(lang, 'Không chỉ dừng ở chat', 'Beyond the chat window')}</h2><Mochi role="BA" className="why-mochi" /></div>
      <dl>{comparisons.map(([vi, en, bodyVi, bodyEn]) => <div key={en}><dt><Check size={19} aria-hidden="true" />{text(lang, vi, en)}</dt><dd>{text(lang, bodyVi, bodyEn)}</dd></div>)}</dl>
    </div></section>

    <section className="section wrap install-grid"><div>
      <p className="eyebrow">05 / {text(lang, 'Bắt đầu', 'Get started')}</p><h2>{text(lang, 'Mở xưởng trên máy bạn', 'Open your own Factory')}</h2>
      <p className="section-intro">{text(lang, 'Dành cho Linux x64. Sau khi chạy, mở Factory ở http://127.0.0.1:8787/.', 'For Linux x64. Once running, open Factory at http://127.0.0.1:8787/.')}</p>
      <a className="text-link" href="#/docs/install">{text(lang, 'Xem hướng dẫn cài đặt', 'Read the installation guide')}<ArrowRight size={16} aria-hidden="true" /></a>
    </div><CodeBlock value={install} lang={lang} /></section>
  </>;
}

export function Try({ lang }: { lang: Lang }) {
  const token = import.meta.env.VITE_DEMO_TOKEN?.trim();
  const activities = [
    [FolderTree, 'Mở dự án Recipe Box', 'Open the Recipe Box project', 'Xem agent và workflow đã được chuẩn bị.', 'Explore its preconfigured agents and workflows.'],
    [Settings2, 'Chạy thử với mock agent', 'Test a workflow with mock agents', 'Trong Workflow, chọn Chạy thử và bật Mock agent.', 'In Workflow, choose Test run and turn on Mock agents.'],
    [ShieldCheck, 'Duyệt trong Cần xử lý', 'Approve in Needs attention', 'Mở yêu cầu đang chờ, đọc bằng chứng rồi chọn Duyệt.', 'Open a pending request, read the evidence, then approve.'],
    [Activity, 'Xem Văn phòng và Trace', 'Explore Office and Trace', 'Xem agent đang làm gì, rồi mở Trace để theo dõi từng bước.', 'See what agents are doing, then open Trace to follow each step.'],
  ] as const;
  return <div className="wrap try-page">
    <section className="try-hero"><div><p className="eyebrow"><Sparkles size={16} aria-hidden="true" /> Factory Demo</p><h1>{text(lang, 'Dùng thử Factory', 'Try Factory')}</h1>
      <p>{text(lang, 'Bản demo công khai dùng mock agent, không gọi model thật. Dữ liệu được đặt lại định kỳ; đừng nhập secret hay dữ liệu thật.', 'The public demo uses mock agents and does not call real models. Data is reset regularly; do not enter secrets or real data.')}</p></div><Mochi /></section>
    <section className="demo-connect" aria-labelledby="demo-heading"><div><h2 id="demo-heading">{text(lang, 'Kết nối demo', 'Connect to the demo')}</h2><p>{text(lang, 'Địa chỉ này chỉ truy cập được từ mạng có đường tới máy demo.', 'This private-network address is reachable only from a network that can access the demo host.')}</p><External className="button primary" href={demo}>{demo}</External></div>
      <div><h3>{text(lang, 'Token đăng nhập demo', 'Demo sign-in token')}</h3>{token ? <CodeBlock value={token} lang={lang} label="Token" /> : <p>{text(lang, 'hỏi người quản trị', 'ask the administrator')}</p>}</div></section>
    <section className="try-steps"><p className="eyebrow">{text(lang, 'Gợi ý', 'Suggested steps')}</p><h2>{text(lang, 'Bốn việc nên thử', 'Four things to try')}</h2><ol className="feature-grid">{activities.map(([Icon, vi, en, bodyVi, bodyEn], index) => <li className="tile" key={en}><span className="tile-icon mint"><Icon size={22} aria-hidden="true" /></span><span className="try-number" aria-hidden="true">0{index + 1}</span><h3>{text(lang, vi, en)}</h3><p>{text(lang, bodyVi, bodyEn)}</p></li>)}</ol></section>
  </div>;
}
