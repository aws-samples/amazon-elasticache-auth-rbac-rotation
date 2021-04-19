#!/bin/bash

rm -rf lib/lambda/lambda_layer/workspace
mkdir -p lib/lambda/lambda_layer/workspace

cd lib/lambda/lambda_layer/workspace
pip install redispy -t opt_modules/python/lib/python3.7/site-packages
cd opt_modules
zip -r redis_py.zip .
cd ../../
pwd
cp workspace/opt_modules/redis_py.zip .

cd ..