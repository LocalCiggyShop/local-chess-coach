"""Build a loadable ZIP without development dependencies or generated artifacts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
files = [root / name for name in ('manifest.json', 'offscreen.html', 'popup.html', 'popup.css', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', '.gitignore')]
for directory in ('src', 'assets', 'vendor', 'tests', 'tools'):
    files.extend(p for p in (root / directory).rglob('*') if p.is_file())
target = root / 'Local-Chess-Coach.zip'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root))
print(f'{target.name}: {len(files)} files, {target.stat().st_size:,} bytes')
