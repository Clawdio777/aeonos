#!/bin/sh
set -e

# Ensure /data dirs exist
mkdir -p /data/logs /data/config/acp /data/share /data/run

# Start D-Bus session daemon
eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID

# Write D-Bus address so SSH sessions can source it and share the keyring
echo "export DBUS_SESSION_BUS_ADDRESS='${DBUS_SESSION_BUS_ADDRESS}'" > /data/run/dbus.sh
chmod 600 /data/run/dbus.sh

# Unlock gnome-keyring with empty password (keyring DB lives on /data volume)
printf '' | gnome-keyring-daemon --daemonize --unlock --components=secrets 2>/dev/null || true
sleep 0.5

exec node /app/seller-v2.mjs
