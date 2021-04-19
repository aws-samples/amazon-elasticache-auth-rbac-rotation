/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import cdk = require('@aws-cdk/core');
import kms = require ('@aws-cdk/aws-kms');
import iam = require('@aws-cdk/aws-iam');
import elasticache = require('@aws-cdk/aws-elasticache');
import secretsmanager = require('@aws-cdk/aws-secretsmanager');
import lambda = require('@aws-cdk/aws-lambda');
import path = require('path');

export interface RedisAuthSecretProps {
  clusterId: string;
  kmsKey?: kms.Key;
  excludeCharacters?: string;
  principals?: iam.IPrincipal[]
}

export class RedisAuthSecret extends cdk.Construct {
  private redisSecret: secretsmanager.Secret;
  private readSecretResourcePolicyStatement: iam.PolicyStatement;
  private rotateSecretResourcePolicyStatement: iam.PolicyStatement;
  private kmsKey: kms.Key;

  constructor(scope: cdk.Construct, id: string, props: RedisAuthSecretProps) {
    super(scope, id);

    if (!props.kmsKey) {
      this.kmsKey = new kms.Key(this, 'kmsForSecret', {
        alias: 'redisSecret/'+props.clusterId,
        enableKeyRotation: true
      });
    } else {
      this.kmsKey = props.kmsKey;
    }

    this.redisSecret = new secretsmanager.Secret(this, 'secret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ clusterId: props.clusterId }),
        generateStringKey: 'password',
        excludeCharacters: '@%*()_+=`~{}|[]\\:";\'?,./'
      },
      encryptionKey: this.kmsKey
    });
  }

  public grantReadSecret(principal: iam.IPrincipal){
    if (this.readSecretResourcePolicyStatement == null) {
      this.readSecretResourcePolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'],
        resources: [this.redisSecret.secretArn],
        principals: [principal]
      })

      this.redisSecret.addToResourcePolicy(this.readSecretResourcePolicyStatement)

    } else {
      this.readSecretResourcePolicyStatement.addPrincipals(principal)
    }
    this.kmsKey.grantDecrypt(principal);
    this.redisSecret.grantRead(principal)
  }

  public grantRotateSecret(principal: iam.IPrincipal){
    if (this.rotateSecretResourcePolicyStatement == null) {
      this.rotateSecretResourcePolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ],
        resources: [this.redisSecret.secretArn],
        principals: [principal]
      })

      this.redisSecret.addToResourcePolicy(this.rotateSecretResourcePolicyStatement)

    } else {
      this.rotateSecretResourcePolicyStatement.addPrincipals(principal)
    }
    this.kmsKey.grantEncryptDecrypt(principal);
    this.redisSecret.grantRead(principal);
    this.redisSecret.grantWrite(principal);
  }
}