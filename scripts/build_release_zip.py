import os
import zipfile

def build_zip():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    zip_path = os.path.join(base_dir, 'umspec-release.zip')
    
    include_files = [
        'manifest.json',
        'PRIVACY.md',
        'README.md',
        'LICENSE',
        'docs/GOOGLE_SETUP.md',
        'docs/IMPLEMENTATION_STATUS.md'
    ]
    include_dirs = [
        'icons',
        'lib',
        'popup',
        'content',
        'shared',
        'background',
        'setup'
    ]
    
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for f in include_files:
            fp = os.path.join(base_dir, f)
            if os.path.exists(fp):
                zf.write(fp, arcname=f)
                print(f"Added {f}")
        
        for d in include_dirs:
            dp = os.path.join(base_dir, d)
            for root, dirs, files in os.walk(dp):
                for file in files:
                    full_p = os.path.join(root, file)
                    rel_p = os.path.relpath(full_p, base_dir).replace('\\', '/')
                    zf.write(full_p, arcname=rel_p)
                    print(f"Added {rel_p}")

    print(f"\nSuccessfully built {zip_path}")

if __name__ == '__main__':
    build_zip()
