export const collaborationIdlePollInterval = 30_000;

export function shouldPollCollaborativeSession(options: {
  visible: boolean;
  pendingSubmission: boolean;
  activeRun: boolean;
}) {
  return options.visible && !options.pendingSubmission && !options.activeRun;
}
