mods := env("HERDR_APP_HOME", env("HOME") / ".config/herdr-app") / "mods"

# Link the pixel-party mod into the Herdr app's home and check that it loads
install:
    mkdir -p "{{ mods }}"
    if [ -e "{{ mods }}/pixel-party" ] && [ ! -L "{{ mods }}/pixel-party" ]; then \
        echo "{{ mods }}/pixel-party exists and is not a link; move it aside and run again" >&2; exit 1; \
    fi
    ln -sfn "$PWD/mods/pixel-party" "{{ mods }}/pixel-party"
    herdr-app check "{{ mods }}/pixel-party"

# Add the bee hooks to Claude Code and Codex, keeping what their settings hold (`just hooks --dry-run` first; `just hooks claude`)
hooks *args:
    node tools/install-hooks.mjs {{ args }}

# Load the mod once and report what's wrong
check:
    herdr-app check "$PWD/mods/pixel-party"

# Check the mod's JSDoc types against types/ (no Herdr needed; run `pnpm install` once)
typecheck:
    pnpm typecheck

# Run the sprite and view tests (no Herdr needed)
test:
    node --import ./tests/mocks/register.mjs --test 'tests/*.test.mjs'

# Float the drawer in a layout (default: the shown one), e.g. `just dock my-layout --edge left`
dock *args:
    node tools/dock.mjs dock {{ args }}

# Take the drawer out of a layout (default: the shown one)
undock *args:
    node tools/dock.mjs undock {{ args }}

# Make the optional sounds again with ffmpeg: a thunk for a stamp, a poof for an arrival
sounds:
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=f=75:d=0.22:sample_rate=44100" -f lavfi -i "anoisesrc=d=0.22:c=brown:a=0.8:s=7:r=44100" -filter_complex "[0][1]amix=inputs=2:weights=1 0.7:normalize=0,lowpass=f=500,afade=t=out:st=0.01:d=0.21:curve=exp,volume=7dB" -ac 1 -b:a 64k -map_metadata -1 mods/pixel-party/sounds/stamp.mp3
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=d=0.3:c=pink:a=0.6:s=3:r=44100" -af "highpass=f=400,lowpass=f=2500,afade=t=in:d=0.04,afade=t=out:st=0.05:d=0.25:curve=qsin,volume=10dB" -ac 1 -b:a 64k -map_metadata -1 mods/pixel-party/sounds/arrive.mp3
