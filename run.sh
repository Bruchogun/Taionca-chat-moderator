#!/bin/bash

MAX_RETRIES=3
RETRY_DELAY=10
LOG_FILE="/home/brucho/Taionca-chat-moderator/cron.log"

echo "=== $(date): Initializing Taionca bot ===" >> "$LOG_FILE"

cd /home/brucho/Taionca-chat-moderator

for i in $(seq 1 $MAX_RETRIES); do
    echo "$(date): Try $i of $MAX_RETRIES" >> "$LOG_FILE"
    
    /usr/bin/node index.js >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "$(date): Bot has started" >> "$LOG_FILE"
        exit 0
    else
        echo "$(date): Error (code $EXIT_CODE). Retrying in ${RETRY_DELAY}s..." >> "$LOG_FILE"
        sleep $RETRY_DELAY
    fi
done

echo "$(date): ERROR - Failed after $MAX_RETRIES tries" >> "$LOG_FILE"
exit 1