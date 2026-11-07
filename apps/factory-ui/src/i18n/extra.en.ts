export const extra = {
  auth: { signIn: 'Sign in', signOut: 'Sign out', token: 'Bootstrap token', required: 'Sign in to continue.' },
  projects: { create: 'Create project', name: 'Project name', root: 'Workspace path', empty: 'No projects yet.' },
  tasks: { plan: 'Plan', proposed: 'Proposed task', accept: 'Accept task', decline: 'Decline task', empty: 'No tasks yet.' },
  errors: { title: 'Could not load data', retry: 'Retry', correlationId: 'Reference', network: 'Cannot reach the Host.' },
  empty: { conversations: 'No conversations yet.', messages: 'No messages yet.', team: 'No team assigned.' },
} as const;
