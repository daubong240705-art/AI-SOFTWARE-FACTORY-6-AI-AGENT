export const extra = {
  auth: { signIn: 'Sign in', signOut: 'Sign out', token: 'Bootstrap token', required: 'Sign in to continue.', explanation: 'The one-time bootstrap token is printed by the Host when it starts.' },
  projects: { create: 'Create project', name: 'Project name', root: 'Workspace path', empty: 'No projects yet.', rootPlaceholder: '/srv/factory/workspaces/my-project' },
  tasks: { plan: 'Plan', proposed: 'Proposed task', accept: 'Accept task', decline: 'Decline task', empty: 'No tasks yet.' },
  errors: { title: 'Could not load data', retry: 'Retry', correlationId: 'Reference', network: 'Cannot reach the Host.' },
  empty: { conversations: 'No conversations yet.', messages: 'No messages yet.', team: 'No team assigned.' },
  shell: { product: 'Factory', theme: 'Theme', light: 'Light', dark: 'Dark', system: 'System', language: 'Language', english: 'English', vietnamese: 'Tiếng Việt', toggleProjects: 'Toggle projects', live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline', welcome: 'Your projects', chooseProject: 'Select a project or create one to get started.', comingSoon: 'Coming in the next step', projectTabs: 'Project views' },
  tabs: { chat: 'Chat', tasks: 'Tasks', team: 'Team' },
  validation: { projectName: 'Enter a project name between 1 and 160 characters.', workspacePath: 'Enter an absolute Linux path of at most 4096 characters without . or .. segments, backslashes or NUL.' },
  team: { engagement: 'Engagement', priority: 'Priority', maxConcurrent: 'Max concurrent', state: 'State', seats: 'Seats', emptySeats: 'No seats assigned.', lead: 'Lead', role: 'Role', runtime: 'Runtime', slots: 'Slots', states: { active: 'Active', paused: 'Paused', ended: 'Ended' } },
  safeErrors: { validation: 'Invalid request.', conflict: 'The resource changed.', 'needs-auth': 'Authentication required.', 'permission-configuration': 'Permission configuration required.', 'resource-exhausted': 'Resources temporarily unavailable.', 'runtime-unavailable': 'Runtime unavailable.', 'outcome-unknown': 'Command outcome unknown.', 'not-found': 'Resource not found.', forbidden: 'Request forbidden.', unsupported: 'Command unsupported.', internal: 'Internal server error.', network: 'Cannot reach the Host.', 'bad-response': 'Invalid Host response.', unexpected: 'The operation could not be completed.' },
} as const;
