import { Button } from "@tweakpad/ui/react";

import { GithubMark } from "@/components/app/GithubMark";
import { REPO_LABEL, REPO_URL } from "@/lib/constants";

// Persistent bottom status bar: project name + app/runtime versions on the left, GitHub link on the right.
export function StatusBar() {
  return (
    <footer className="workspace-footer">
      <div className="workspace-footer__meta">
        <span className="workspace-footer__name">Material Designer</span>
        <span className="workspace-footer__dim">v{__APP_VERSION__}</span>
        <span className="workspace-footer__sep">·</span>
        <span className="workspace-footer__dim">runtime v{__RUNTIME_VERSION__}</span>
        <span className="workspace-footer__sep">·</span>
        <span className="workspace-footer__dim" title="Build commit">{__COMMIT_HASH__}</span>
      </div>
      <Button href={REPO_URL} rel="noreferrer" size="xs" target="_blank" variant="ghost">
        <GithubMark slot="icon-start" />
        {REPO_LABEL}
      </Button>
    </footer>
  );
}
