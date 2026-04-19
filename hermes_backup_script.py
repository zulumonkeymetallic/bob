import os
import tarfile
import datetime
import shutil
from pathlib import Path

# Configuration
BACKUP_DIR = Path("/Users/jim/Library/CloudStorage/GoogleDrive-Jdonnelly@jc1.tech/Shared drives/BOB-OC-AI/agent-backups")
HERMES_HOME = Path.home() / ".hermes"
CLAUDE_DIR = Path.home() / "claude"
DATA_DIR = Path.home() / "data"
MAX_BACKUPS = 5

def create_backup():
    if not BACKUP_DIR.exists():
        BACKUP_DIR.mkdir(parents=True)
    
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_path = BACKUP_DIR / f"agent_backup_{timestamp}.tar.gz"
    
    print(f"[backup] Creating {backup_path}")
    
    with tarfile.open(backup_path, "w:gz") as tar:
        # Directories to back up
        to_backup = [
            (HERMES_HOME / "skills", "skills"),
            (HERMES_HOME / "memories", "memories"),
            (HERMES_HOME / "SOUL.md", "SOUL.md"),
            (HERMES_HOME / "startup_prompt.md", "startup_prompt.md"),
            (HERMES_HOME / "config.yaml", "config.yaml"),
            (HERMES_HOME / "scripts", "scripts"),
            (HERMES_HOME / "jobs.json", "jobs.json"),
            (CLAUDE_DIR / "CLAUDE.md", "CLAUDE.md"),
            (CLAUDE_DIR / "bob-project-memory", "bob-project-memory"),
            (DATA_DIR / "latest_snapshot.json", "latest_snapshot.json"),
        ]
        
        for path, arcname in to_backup:
            if path.exists():
                print(f"[backup]   + {arcname}")
                tar.add(path, arcname=arcname)
            else:
                print(f"[backup]   ! {path} not found")
                
    print(f"[backup] Done → {backup_path}")
    prune_backups()

def prune_backups():
    backups = sorted(BACKUP_DIR.glob("agent_backup_*.tar.gz"), key=os.path.getmtime, reverse=True)
    if len(backups) > MAX_BACKUPS:
        for old_backup in backups[MAX_BACKUPS:]:
            print(f"[backup] Pruning old backup: {old_backup.name}")
            old_backup.unlink()

def restore_backup(backup_file):
    if not backup_file.exists():
        print(f"[restore] Error: Backup {backup_file} not found")
        return
    
    print(f"[restore] Extracting {backup_file} to restore point...")
    with tarfile.open(backup_file, "r:gz") as tar:
        # Restore to a temp location first
        restore_root = Path.home() / ".hermes_restore_temp"
        if restore_root.exists(): shutil.rmtree(restore_root)
        tar.extractall(restore_root)
        
        # Mapping extraction
        mapping = [
            ("skills", HERMES_HOME / "skills"),
            ("memories", HERMES_HOME / "memories"),
            ("SOUL.md", HERMES_HOME / "SOUL.md"),
            ("startup_prompt.md", HERMES_HOME / "startup_prompt.md"),
            ("config.yaml", HERMES_HOME / "config.yaml"),
            ("scripts", HERMES_HOME / "scripts"),
            ("jobs.json", HERMES_HOME / "jobs.json"),
            ("CLAUDE.md", CLAUDE_DIR / "CLAUDE.md"),
            ("bob-project-memory", CLAUDE_DIR / "bob-project-memory"),
            ("latest_snapshot.json", DATA_DIR / "latest_snapshot.json"),
        ]
        
        for src, dest in mapping:
            src_path = restore_root / src
            if src_path.exists():
                if dest.is_dir(): shutil.rmtree(dest)
                if src_path.is_dir():
                    shutil.copytree(src_path, dest)
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src_path, dest)
                print(f"[restore] Restored {src} to {dest}")
        
        shutil.rmtree(restore_root)
    print("[restore] Done")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "restore":
        if len(sys.argv) > 2:
            restore_backup(Path(sys.argv[2]))
        else:
            print("Usage: hermes_backup_script.py restore <backup_file_path>")
    else:
        create_backup()
