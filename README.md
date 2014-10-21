cps-mailin
==========

Custom SMTP server to remotely execute AutoHotKey Scripts that require an interactive Winlogon session.
Enables UI Automation inside a disconnected RDP session running fully in the background.

Uses powershell for remote file-copy, wfreerdp for starting remote interactive winlogon session, and psexec for remote execution.
Requires tcp port 135 (PsExec) and tcp port 3389 (RDP) to be open on remote target.
Recommended for RDPWrapper to be installed (if remote target is non-server edition of Microsoft Windows).

Documentation coming soon. Meanwhile, look at app.js .
