#!/bin/bash
# Boot an iPhone simulator, install Black Ram, and save screenshots plus a short tour video.
set -euo pipefail

APP="${1:?path to BlackRam.app}"
OUT="${2:?output directory}"
BUNDLE="com.blackramtowing.hotshotrate"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
UDID=""
REC_PID=""

cleanup() {
  if [ -n "${REC_PID}" ]; then
    kill -INT "${REC_PID}" >/dev/null 2>&1 || true
    wait "${REC_PID}" >/dev/null 2>&1 || true
    REC_PID=""
  fi
  if [ -n "${UDID}" ]; then
    xcrun simctl shutdown "${UDID}" >/dev/null 2>&1 || true
    xcrun simctl delete "${UDID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ ! -d "${APP}" ]; then
  echo "App not found: ${APP}" >&2
  exit 1
fi

mkdir -p "${OUT}"

pick_device() {
  local types line
  types="$(xcrun simctl list devicetypes)"
  line="$(printf '%s\n' "${types}" | grep 'iPhone 16 Pro (' | head -1 || true)"
  if [ -z "${line}" ]; then
    line="$(printf '%s\n' "${types}" | grep -E 'iPhone .* Pro \(' | head -1 || true)"
  fi
  if [ -z "${line}" ]; then
    line="$(printf '%s\n' "${types}" | grep -E 'iPhone ' | head -1 || true)"
  fi
  if [ -z "${line}" ]; then
    echo "No iPhone simulator device type is installed" >&2
    xcrun simctl list devicetypes >&2 || true
    exit 1
  fi
  printf '%s\n' "${line}" | sed 's/ (com.apple.CoreSimulator.*//'
}

DEVICE="$(pick_device)"
echo "Simulator device: ${DEVICE}"
printf '%s\n' "${DEVICE}" > "${OUT}/device.txt"

xcrun simctl shutdown all >/dev/null 2>&1 || true
UDID="$(xcrun simctl create "BlackRam Capture" "${DEVICE}")"
echo "Booting ${UDID}"
xcrun simctl boot "${UDID}"
xcrun simctl bootstatus "${UDID}" -b
sleep 2

xcrun simctl status_bar "${UDID}" override \
  --time "9:41" \
  --batteryState charged \
  --batteryLevel 100 \
  --wifiBars 3 \
  --cellularMode active \
  --cellularBars 4 >/dev/null 2>&1 || true

if ! xcrun simctl install "${UDID}" "${APP}"; then
  codesign --force --deep --sign - "${APP}"
  xcrun simctl install "${UDID}" "${APP}"
fi

shot() {
  local mode="$1"
  local file="$2"
  local pause="$3"
  local width
  xcrun simctl terminate "${UDID}" "${BUNDLE}" >/dev/null 2>&1 || true
  sleep 0.5
  SIMCTL_CHILD_BLACKRAM_CAPTURE="${mode}" xcrun simctl launch "${UDID}" "${BUNDLE}" >/dev/null
  sleep "${pause}"
  xcrun simctl io "${UDID}" screenshot "${OUT}/${file}"
  width="$(sips -g pixelWidth "${OUT}/${file}" | awk '/pixelWidth/ {print $2}')"
  echo "${file} ${width}px $(stat -f%z "${OUT}/${file}") bytes"
  if [ "${width:-0}" -lt 1000 ]; then
    echo "Screenshot is not full resolution: ${file}" >&2
    exit 1
  fi
}

shot launch launch-screen.png 1.2
shot home load-check.png 3
shot take load-check-take.png 3
shot reports reports.png 6
shot kpis kpis.png 6

xcrun simctl terminate "${UDID}" "${BUNDLE}" >/dev/null 2>&1 || true
sleep 0.5
VIDEO="${OUT}/blackram-tour.mp4"
xcrun simctl io "${UDID}" recordVideo --codec=h264 --force "${VIDEO}" &
REC_PID=$!
sleep 1
SIMCTL_CHILD_BLACKRAM_CAPTURE=tour xcrun simctl launch "${UDID}" "${BUNDLE}" >/dev/null
sleep 16
kill -INT "${REC_PID}" || true
wait "${REC_PID}" || true
REC_PID=""

if [ ! -s "${VIDEO}" ]; then
  echo "Video was not recorded" >&2
  exit 1
fi

bytes="$(stat -f%z "${VIDEO}")"
echo "video ${bytes} bytes"
if [ "${bytes}" -gt 14000000 ]; then
  echo "Compressing video"
  swiftc -O "${SCRIPT_DIR}/compress-video.swift" -o "${OUT}/compress-video"
  "${OUT}/compress-video" "${VIDEO}" "${OUT}/blackram-tour-small.mp4" AVAssetExportPreset1280x720
  mv "${OUT}/blackram-tour-small.mp4" "${VIDEO}"
  rm -f "${OUT}/compress-video"
  bytes="$(stat -f%z "${VIDEO}")"
  echo "video after compress ${bytes} bytes"
fi
if [ "${bytes}" -gt 15000000 ]; then
  echo "Video is over 15 MB" >&2
  exit 1
fi

xcrun simctl terminate "${UDID}" "${BUNDLE}" >/dev/null 2>&1 || true
echo "Capture complete"
