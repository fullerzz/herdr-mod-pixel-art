mods := env("HERDR_APP_HOME", env("HOME") / ".config/herdr-app") / "mods"

# Link the pixel-party mod into the Herdr app's home and check that it loads
install:
    mkdir -p "{{ mods }}"
    if [ -e "{{ mods }}/pixel-party" ] && [ ! -L "{{ mods }}/pixel-party" ]; then \
        echo "{{ mods }}/pixel-party exists and is not a link; move it aside and run again" >&2; exit 1; \
    fi
    ln -sfn "$PWD/mods/pixel-party" "{{ mods }}/pixel-party"
    herdr-app check "{{ mods }}/pixel-party"

# Load the mod once and report what's wrong
check:
    herdr-app check "$PWD/mods/pixel-party"

# Run the sprite and view tests (no Herdr needed)
test:
    node --import ./tests/mocks/register.mjs --test 'tests/*.test.mjs'

# Float the drawer in a layout (default: the shown one), e.g. `just dock my-layout --edge left`
dock *args:
    node tools/dock.mjs dock {{ args }}

# Take the drawer out of a layout (default: the shown one)
undock *args:
    node tools/dock.mjs undock {{ args }}
