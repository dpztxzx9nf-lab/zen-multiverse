#!/bin/bash
# run a heavy command at low priority, frozen (SIGSTOP) while another worker's build/test runs
nice -n 19 "$@" & P=$!
while kill -0 $P 2>/dev/null; do
  if pgrep -f 'cargo|tauri|gshoot|chrome --|soak.mjs|blender' >/dev/null; then pkill -STOP -f realesrgan-ncnn-vulkan; S=1; else [ "$S" = 1 ] && pkill -CONT -f realesrgan-ncnn-vulkan; S=0; fi
  sleep 3
done
wait $P
