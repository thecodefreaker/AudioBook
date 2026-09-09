#!/bin/bash

if [ -z "$1" ]; then
  echo "Please provide a port number."
  echo "Usage: ./start-tunnel.sh <PORT>"
  echo "Example: ./start-tunnel.sh 5173"
  exit 1
fi

PORT=$1
echo "Starting Cloudflare Quick Tunnel for http://localhost:$PORT..."
echo "Waiting for Cloudflare to generate your URL..."
echo "--------------------------------------------------------"

cloudflared tunnel --protocol http2 --url http://localhost:$PORT
