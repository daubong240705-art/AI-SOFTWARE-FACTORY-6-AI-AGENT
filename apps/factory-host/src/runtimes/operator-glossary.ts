export function operatorGlossary(language: string): string {
  return /^Vietnamese$/i.test(language)
    ? "Viết câu tự nhiên bằng tiếng Việt, nhưng giữ nguyên các thuật ngữ tiếng Anh: secret, API key, token, integration, workflow, node, run, attempt, draft, publish, version, template (agent template, team template, workflow template), skill, tool, team, group, model, model provider, runtime, effort, pinned data, mock agent, session, backup, trace, monitor, branch, commit, merge, repo, worktree, workspace, log, prompt, deploy và task. Viết hoa chữ đầu khi thuật ngữ đứng đầu nhãn hoặc tiêu đề; không thêm s số nhiều. Dùng Trigger, Action, Condition, Parallel, Join, Approval, Loop, Wait, Sub-workflow, Orchestrate và Output cho tên loại node. Giữ nguyên tên màn hình Bảng việc, Văn phòng, Thế giới, Cần xử lý, Thư viện, Hệ thống, Cài đặt, Tổng quan, Tài liệu và Mã nguồn."
    : "";
}
