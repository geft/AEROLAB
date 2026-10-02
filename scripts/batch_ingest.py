#!/usr/bin/env python3
"""
AEROLAB — Batch Raw Data Ingestion Script (Python)
--------------------------------------------------
Drop your Garmin .fit or activity .zip files into a folder (default: data/raw/)
and run this script to automatically import all activities into AEROLAB.

Usage:
    python scripts/batch_ingest.py
    python scripts/batch_ingest.py --dir "C:/path/to/my_garmin_files"
    python scripts/batch_ingest.py --force --clean
"""

import os
import sys
import argparse
import base64
import json
import urllib.request
import urllib.error
from pathlib import Path

def is_fit_file(file_path: Path) -> bool:
    """
    Determine if a file is a Garmin FIT binary file.
    Checks file extension and inspects protocol magic bytes 8..11 (b'.FIT').
    """
    if file_path.suffix.lower() == ".fit":
        return True
    try:
        if file_path.stat().st_size >= 12:
            with open(file_path, "rb") as f:
                header = f.read(14)
                if len(header) >= 12 and header[8:12] == b".FIT":
                    return True
    except Exception:
        pass
    return False

def main():
    parser = argparse.ArgumentParser(description="Batch import Garmin FIT and activity ZIP runs into AEROLAB.")
    parser.add_argument(
        "target",
        nargs="?",
        default=None,
        help="Path to folder or single activity file (default: data/raw/)"
    )
    parser.add_argument(
        "--dir", "-d",
        default=None,
        help="Folder containing .fit and/or .zip files (alternative to positional target)"
    )
    parser.add_argument(
        "--server", "-s",
        default="http://localhost:3001",
        help="AEROLAB API server base URL (default: http://localhost:3001)"
    )
    parser.add_argument(
        "--force", "-f",
        action="store_true",
        help="Force re-import and overwrite existing activities"
    )
    parser.add_argument(
        "--clean", "-c",
        action="store_true",
        help="Delete raw files from the folder after successful import"
    )

    args = parser.parse_args()
    raw_target = args.target or args.dir or "data/raw"
    target_path = Path(raw_target).resolve()

    print("=" * 60)
    print("🏃 AEROLAB — Batch Activity Ingestion")
    print("=" * 60)
    print(f"📁 Target Path   : {target_path}")
    print(f"🌐 Server URL    : {args.server}")
    print(f"⚡ Overwrite     : {'YES (--force)' if args.force else 'No (skip duplicates)'}")
    print(f"🧹 Auto Clean    : {'YES (--clean)' if args.clean else 'No'}")
    print("-" * 60)

    # Check if target is a single file
    if target_path.is_file():
        files_to_process = [target_path]
    elif not target_path.exists():
        target_path.mkdir(parents=True, exist_ok=True)
        print(f"Created target directory: {target_path}")
        print("Please drop your Garmin .fit or activity .zip files into this folder and re-run.")
        sys.exit(0)
    else:
        # Gather files from directory
        supported_extensions = {".fit", ".zip"}
        files_to_process = [
            f for f in target_path.iterdir()
            if f.is_file() and (f.suffix.lower() in supported_extensions or is_fit_file(f))
        ]
        files_to_process.sort(key=lambda x: x.name)

    if not files_to_process:
        print(f"No .fit or .zip files found in: {target_path}")
        print("Drop your activity files into the folder and run this script again.")
        sys.exit(0)

    print(f"Found {len(files_to_process)} activity file(s) to process.\n")

    # Check server health
    health_url = f"{args.server.rstrip('/')}/api/health"
    try:
        req = urllib.request.Request(health_url, headers={"User-Agent": "AerolabBatchIngest/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status != 200:
                print(f"⚠️ Warning: Server responded with status {resp.status}")
    except Exception as e:
        print(f"❌ Error: Cannot connect to AEROLAB server at {args.server}")
        print("Make sure the AEROLAB dev server is running:")
        print("    npm run dev")
        print("or run the TypeScript CLI directly:")
        print("    npm run ingest")
        sys.exit(1)

    upload_url = f"{args.server.rstrip('/')}/api/ingest/upload"

    imported_count = 0
    skipped_count = 0
    error_count = 0
    clean_list = []

    for idx, file_path in enumerate(files_to_process, 1):
        filename = file_path.name
        is_fit = is_fit_file(file_path)
        algo_label = "FIT" if is_fit else "ZIP"

        print(f"[{idx}/{len(files_to_process)}] Processing [{algo_label}]: {filename} ...", end=" ", flush=True)

        try:
            with open(file_path, "rb") as bf:
                raw_bytes = bf.read()
                content_str = base64.b64encode(raw_bytes).decode("ascii")

            payload = json.dumps({
                "content": content_str,
                "filename": filename,
                "force": args.force
            }).encode("utf-8")

            req = urllib.request.Request(
                upload_url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "AerolabBatchIngest/1.0"
                }
            )

            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                result = resp_data.get("result", {})
                status = result.get("status")

                if status == "imported":
                    imported_count += 1
                    dist = result.get("distanceKm", 0)
                    rtype = result.get("runType", "run")
                    ef = result.get("efficiencyFactor", "—")
                    print(f"✅ IMPORTED ({dist}km | {rtype} | EF: {ef})")
                    clean_list.append(file_path)
                elif status == "skipped_duplicate":
                    skipped_count += 1
                    print("⏭️  SKIPPED (Duplicate)")
                    clean_list.append(file_path)
                else:
                    error_count += 1
                    print(f"⚠️ {result.get('error', 'Unknown result')}")

        except urllib.error.HTTPError as he:
            error_count += 1
            try:
                err_body = json.loads(he.read().decode("utf-8"))
                msg = err_body.get("error", str(he))
            except:
                msg = str(he)
            print(f"❌ HTTP Error: {msg}")
        except Exception as ex:
            error_count += 1
            print(f"❌ Error: {ex}")

    # Optional cleanup
    if args.clean and clean_list:
        print(f"\n🧹 Cleaning up {len(clean_list)} processed file(s)...")
        for f in clean_list:
            try:
                f.unlink()
            except Exception as ce:
                print(f"Could not delete {f.name}: {ce}")

    print("\n" + "=" * 60)
    print("📊 Ingestion Summary:")
    print(f"   ✅ Successfully Imported: {imported_count}")
    print(f"   ⏭️  Duplicates Skipped   : {skipped_count}")
    print(f"   ❌ Errors               : {error_count}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()
