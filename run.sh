#!/usr/bin/env sh

export APP_PATH=$(dirname `pwd`)

export NODE_PATH=\
$NODE_PATH\
:$APP_PATH\
:$APP_PATH/lib/redis-client.js

node "$@"

