@echo off
setlocal
cd /d "%~dp0\.."

echo ========================================================
echo Deleting game logs from AWS S3...
echo ========================================================

if exist ".venv\Scripts\python.exe" (
    set "PYTHON_EXE=.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

"%PYTHON_EXE%" -c "import os, sys, boto3; from dotenv import load_dotenv; load_dotenv(); bucket_name = os.environ.get('S3_BUCKET'); region = os.environ.get('AWS_REGION', 'eu-central-1'); aws_key = os.environ.get('AWS_ACCESS_KEY_ID'); aws_secret = os.environ.get('AWS_SECRET_ACCESS_KEY'); (print('Error: S3_BUCKET not found in .env') or sys.exit(1)) if not bucket_name else None; s3 = boto3.resource('s3', region_name=region, aws_access_key_id=aws_key, aws_secret_access_key=aws_secret); bucket = s3.Bucket(bucket_name); print(f'Target Bucket: {bucket_name}'); [print(f'Deleted {sum(1 for _ in [obj.delete() for obj in bucket.objects.filter(Prefix=prefix)])} objects in {prefix}') for prefix in ['csv/', 'logs/', 'combined/']]; print('AWS S3 cleanup completed successfully!')"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] An error occurred while clearing AWS S3 logs.
)

echo.
pause

