param([switch]$RunApiTests, [switch]$SkipMigrations)

$ErrorActionPreference = 'Stop'

# Fail before opening a socket. The current repo .env production project is an
# independent denylist even if SUPABASE_PRODUCTION_URL was entered incorrectly.
if ($env:SUPABASE_TEST_CONFIRMATION -ne 'ISOLATED_TEST_DATABASE') {
  throw 'ISOLATED_CONFIRMATION_REQUIRED'
}
$testRef = $env:SUPABASE_TEST_PROJECT_REF
if ([string]::IsNullOrWhiteSpace($testRef) -or $testRef -notmatch '^[a-z0-9-]+$') {
  throw 'STAGING_PROJECT_REF_REQUIRED'
}
if ($testRef -eq 'hgufhnytbkbmivhofqeu') {
  throw 'PRODUCTION_PROJECT_FORBIDDEN'
}
if ($env:SUPABASE_TEST_DB_HOST -ne "db.$testRef.supabase.co") {
  throw 'STAGING_DB_HOST_MISMATCH'
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_PRODUCTION_URL)) {
  throw 'PRODUCTION_URL_REQUIRED'
}
try {
  $stagingApi = [uri]$env:SUPABASE_TEST_URL
  $productionApi = [uri]$env:SUPABASE_PRODUCTION_URL
} catch {
  throw 'INVALID_SUPABASE_URL'
}
if ($stagingApi.Scheme -ne 'https' -or
    $stagingApi.Host -ne "$testRef.supabase.co") {
  throw 'STAGING_PROJECT_REF_MISMATCH'
}
if ($stagingApi.Host -eq $productionApi.Host -or
    $stagingApi.Host -eq 'hgufhnytbkbmivhofqeu.supabase.co') {
  throw 'PRODUCTION_PROJECT_FORBIDDEN'
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_TEST_DB_PASSWORD)) {
  throw 'STAGING_DB_PASSWORD_REQUIRED'
}
if ($RunApiTests -and ([string]::IsNullOrWhiteSpace($env:SUPABASE_TEST_PUBLISHABLE_KEY) -or
    [string]::IsNullOrWhiteSpace($env:SUPABASE_TEST_SERVICE_ROLE_KEY))) {
  throw 'STAGING_API_CREDENTIALS_REQUIRED'
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) { throw 'PSQL_NOT_INSTALLED' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$dbUser = if ($env:SUPABASE_TEST_DB_USER) { $env:SUPABASE_TEST_DB_USER } else { 'postgres' }
$dbName = if ($env:SUPABASE_TEST_DB_NAME) { $env:SUPABASE_TEST_DB_NAME } else { 'postgres' }
$dbPort = if ($env:SUPABASE_TEST_DB_PORT) { $env:SUPABASE_TEST_DB_PORT } else { '5432' }
$connection = @('--host', $env:SUPABASE_TEST_DB_HOST, '--port', $dbPort,
  '--username', $dbUser, '--dbname', $dbName, '-X', '--set=ON_ERROR_STOP=1')
$migrations = @(
  '0001_initial.sql',
  '0002_quiz_and_image_support.sql',
  '0003_automation_control_plane.sql',
  '0004_automation_control_rpcs.sql',
  '0005_automation_taipei_clock_after_lock.sql'
)
$migrationArgs = @($connection) + @('--single-transaction')
foreach ($migration in $migrations) {
  $migrationArgs += @('-f', (Join-Path $repoRoot "supabase/migrations/$migration"))
}

$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
try {
  $env:PGPASSWORD = $env:SUPABASE_TEST_DB_PASSWORD
  $env:PGSSLMODE = 'require'
  if (-not $SkipMigrations) {
    & $psql.Source @migrationArgs
    if ($LASTEXITCODE -ne 0) { throw 'STAGING_MIGRATION_FAILED' }
  }
  & $psql.Source @connection -f (Join-Path $repoRoot 'supabase/tests/phase1c_real_sql.sql')
  if ($LASTEXITCODE -ne 0) { throw 'STAGING_SQL_VALIDATION_FAILED' }
} finally {
  $env:PGPASSWORD = $previousPassword
  $env:PGSSLMODE = $previousSslMode
}

if ($RunApiTests) {
  $vitest = Join-Path $repoRoot 'node_modules/.bin/vitest.cmd'
  if (-not (Test-Path -LiteralPath $vitest)) { throw 'NODE_DEPENDENCIES_NOT_INSTALLED' }
  Push-Location $repoRoot
  try {
    & $vitest run tests/integration/automationControlPlane.staging.test.ts --reporter=verbose
    if ($LASTEXITCODE -ne 0) { throw 'STAGING_API_VALIDATION_FAILED' }
  } finally {
    Pop-Location
  }
}
