#!/usr/bin/env bash
# One step of a student-deploy job (Infra/gocd/student-deploy.gocd.yaml). GoCD runs it from the material checkout:
#   bash Infra/gocd/job.sh <step> [stage]
#   clean <stage>          the job's first task: remove this stage's own result files (see below)
#   setup                  install and build Infra/pipeline
#   fetch-input            Build job only: work/deploy-input.json and work/slot from the platform server
#   build                  Build stage; also writes work/deploy-input.built.json (the input with images filled)
#   prepare | render | apply   the stage CLI, on the files the Build job published (work/, and out/slot.yaml for apply)
#   notify <stage>         tell the platform server how the stage ended (runs after a pass and after a failure)
# Every step stops at the first error. Nothing here prints the environment: PIPELINE_NOTIFY_TOKEN and the AWS key
# are in it, and a job log is readable by everyone who can open GoCD.
set -euo pipefail
set +x
cd "$(dirname "$0")/../.."
pipeline=Infra/pipeline
cli() { node "$pipeline/dist/cli/$1.js" "${@:2}"; }
slot() { cat work/slot; }

# The notify CLI is built by `setup`. When setup (pnpm install, tsc) or the artifact fetch before it failed, there is no CLI and
# the run would stay `running` until the server's STALE_RUN_MS. This sends the same failure the CLI sends for a missing report
# (STAGE_NO_REPORT, Infra/pipeline/src/notify.ts noReportNotice) with curl. The token goes in a header read from stdin, never
# on a command line or in the log; curl retries a 503, a refused connection and a timeout.
notify_without_cli() {
  local stage=$1 url=${PLATFORM_API_URL:-} code body answer
  : "${DEPLOY_ID:?DEPLOY_ID is not set}" "${PIPELINE_NOTIFY_TOKEN:?PIPELINE_NOTIFY_TOKEN is not set}"
  # The same rule as the CLI's: https, or http on this machine only (the token must not cross a network in clear).
  [[ $url =~ ^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(127\.0\.0\.1|localhost)(:[0-9]+)?)/?$ ]] || { echo "PLATFORM_API_URL must look like https://api.stairnoworks.com" >&2; return 2; }
  [[ $DEPLOY_ID =~ ^[A-Za-z0-9-]+$ ]] || { echo "DEPLOY_ID has characters a deploy id does not have" >&2; return 2; }
  body=$(printf '{"deployId":"%s","stage":"%s","result":"failed","failure":{"code":"STAGE_NO_REPORT","service":null,"message":"the %s stage left no readable report: setup failed, the notify CLI is not built"}}' "$DEPLOY_ID" "$stage" "$stage")
  [[ $PIPELINE_NOTIFY_TOKEN != *[\"\\]* ]] || { echo "PIPELINE_NOTIFY_TOKEN has a quote or a backslash" >&2; return 2; }
  # `-K -` takes the header from stdin (printf is a builtin, so the token is in no argument list); `-H @-` fails with --retry too.
  # The answer goes to a file, not /dev/null: curl 8.5 fails a retry (error 23) when it cannot truncate its output.
  answer=$(mktemp)
  code=$(printf 'header = "Authorization: Bearer %s"\n' "$PIPELINE_NOTIFY_TOKEN" |
    curl -sS -K - -o "$answer" -w '%{http_code}' --max-time 20 --retry 4 --retry-delay 5 --retry-connrefused \
    -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' --data-binary "$body" "${url%/}/api/pipeline/notify") || code=000
  rm -f "$answer"
  echo "notified $stage failed (STAGE_NO_REPORT, the notify CLI is not built): HTTP $code"
  [[ $code == 2* ]]
}


case ${1:?usage: job.sh <step> [stage]} in
  clean)
    # A result file left by an earlier run would be read by notify (run_if any) as this run's result. This is the job's first
    # task, so it runs before setup, fetch-input and the artifact fetch can fail. Only this stage's own files go: the ones
    # fetched from an earlier stage (work/deploy-input.built.json, render's out/slot.yaml) are not touched here.
    case ${2:?usage: job.sh clean <stage>} in
      build) files=(work/build-report.json work/deploy-input.built.json) ;;
      prepare) files=(out/prepare-report.json) ;;
      render) files=(out/render-report.json out/slot.yaml out/open.yaml) ;;
      apply) files=(out/apply-report.json) ;;
      *) echo "unknown stage: $2" >&2; exit 2 ;;
    esac
    rm -f -- "${files[@]}"
    ;;
  setup)
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
    cd "$pipeline"
    pnpm install --frozen-lockfile
    # The tests are not run here (CI does); only the build output is needed.
    pnpm exec tsc -p tsconfig.build.json
    ;;
  fetch-input)
    : "${DEPLOY_ID:?DEPLOY_ID is empty: this pipeline is started by the platform server (schedule API), not by hand}"
    mkdir -p work
    cli fetch-input work
    ;;
  build)
    # GoCD sets GO_REVISION_<material name>; the buildspec checks out the platform repo at this commit.
    export PLATFORM_COMMIT=${GO_REVISION_PLATFORM:?GO_REVISION_PLATFORM is not set}
    status=0
    cli build work/deploy-input.json work/build-report.json || status=$?
    # The report is there for a failed build too, and the notice needs it. Stage CLIs read the built input.
    if [[ -s work/build-report.json ]]; then
      node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync("work/build-report.json","utf8"));fs.writeFileSync("work/deploy-input.built.json",JSON.stringify(r.input)+"\n")'
    fi
    exit "$status"
    ;;
  prepare) cli prepare work/deploy-input.built.json "$(slot)" out ;;
  render) cli render work/deploy-input.built.json "$(slot)" out ;;
  apply) cli apply work/deploy-input.built.json "$(slot)" out/slot.yaml out ;;
  notify)
    stage=${2:?usage: job.sh notify <stage>}
    case $stage in
      build) report=work/build-report.json ;;
      *) report=out/$stage-report.json ;;
    esac
    # A missing report is the notify CLI's business: it sends the platform failure STAGE_NO_REPORT. Without the CLI, curl does.
    if [[ -f $pipeline/dist/cli/notify.js ]]; then
      cli notify "$stage" "$report"
    else
      notify_without_cli "$stage"
    fi
    ;;
  *)
    echo "unknown step: $1" >&2
    exit 2
    ;;
esac
