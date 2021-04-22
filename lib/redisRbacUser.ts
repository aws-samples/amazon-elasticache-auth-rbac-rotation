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
import ec2 = require ('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');
import elasticache = require('@aws-cdk/aws-elasticache');
import secretsmanager = require('@aws-cdk/aws-secretsmanager');
import lambda = require('@aws-cdk/aws-lambda');
import path = require('path');
import { CfnEC2Fleet } from '@aws-cdk/aws-ec2';

export interface RedisRbacUserProps {
  redisUserName: string;
  redisUserId: string;
  accessString?: string;
  kmsKey?: kms.Key;
  principals?: iam.IPrincipal[];
  rotationSchedule?: cdk.Duration;
  redisPyLayer?: lambda.ILayerVersion[];
  rotatorFunctionVpc?: ec2.Vpc;
  rotatorFunctionSecurityGroups?: ec2.ISecurityGroup[]
}


export class RedisRbacUser extends cdk.Construct {
  public readonly response: string;
  private rbacUserSecret: secretsmanager.Secret;
  private secretResourcePolicyStatement: iam.PolicyStatement;
  private rbacUserName: string;
  private rbacUserId: string;
  private kmsKey: kms.Key;

  public getSecret(): secretsmanager.Secret {
    return this.rbacUserSecret;
  }

  public getUserName(): string {
    return this.rbacUserName;
  }

  public getUserId(): string{
    return this.rbacUserId;
  }

  public getKmsKey(): kms.Key {
    return this.kmsKey;
  }

  public grantReadSecret(principal: iam.IPrincipal){
    if (this.secretResourcePolicyStatement == null) {
      this.secretResourcePolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'],
        resources: [this.rbacUserSecret.secretArn],
        principals: [principal]
      })

      this.rbacUserSecret.addToResourcePolicy(this.secretResourcePolicyStatement)

    } else {
      this.secretResourcePolicyStatement.addPrincipals(principal)
    }
    this.kmsKey.grantDecrypt(principal);
    this.rbacUserSecret.grantRead(principal)
  }

  constructor(scope: cdk.Construct, id: string, props: RedisRbacUserProps) {
    super(scope, id);

    this.rbacUserId = props.redisUserId
    this.rbacUserName = props.redisUserName

    let enableSecretRotation = true
    if (props.redisPyLayer == undefined ||
      props.rotatorFunctionVpc == undefined ||
      props.rotatorFunctionSecurityGroups == undefined){
        enableSecretRotation = false
      }

    if (!props.kmsKey) {
      this.kmsKey = new kms.Key(this, 'kmsForSecret', {
        alias: this.rbacUserName,
        enableKeyRotation: true
      });
    } else {
      this.kmsKey = props.kmsKey;
    }

    this.rbacUserSecret = new secretsmanager.Secret(this, 'secret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: props.redisUserName }),
        generateStringKey: 'password',
        excludeCharacters: '@%*()_+=`~{}|[]\\:";\'?,./'
      },
      encryptionKey: this.kmsKey
    });

    const user = new elasticache.CfnUser(this, 'redisuser', {
      engine: 'redis',
      userName: props.redisUserName,
      accessString: props.accessString? props.accessString : "off +get ~keys*",
      userId: props.redisUserId,
      passwords: [this.rbacUserSecret.secretValueFromJson('password').toString()]
    })

    user.node.addDependency(this.rbacUserSecret)

    if(props.principals){
      props.principals.forEach( (item) => {
          this.grantReadSecret(item)
      });
    }

    if (enableSecretRotation) {
      const rotatorRole = new iam.Role(this, 'rotatorRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        description: 'Role to be assumed by producer  lambda',
      });

      rotatorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
      rotatorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"));
      rotatorRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: [this.rbacUserSecret.secretArn],
          actions: [
            "secretsmanager:DescribeSecret",
            "secretsmanager:GetSecretValue",
            "secretsmanager:PutSecretValue",
            "secretsmanager:UpdateSecretVersionStage",
          ]
        })
      );


      rotatorRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: ["*"],
          actions: [
            "secretsmanager:GetRandomPassword"
          ]
        })
      );

      const rbacCredentialRotator = new lambda.Function(this, 'RotatorFunction', {
        runtime: lambda.Runtime.PYTHON_3_7,
        handler: 'lambda_handler.lambda_handler',
        code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/lambda_rotator')),
        layers: props.redisPyLayer,
        role: rotatorRole,
        vpc: props.rotatorFunctionVpc,
        vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE},
        securityGroups: props.rotatorFunctionSecurityGroups,
        environment: {
          secret_arn: this.rbacUserSecret.secretArn,
          EXCLUDE_CHARACTERS: '@%*()_+=`~{}|[]\\:";\'?,./',
          SECRETS_MANAGER_ENDPOINT: "https://secretsmanager."+cdk.Stack.of(this).region+".amazonaws.com"
        }
      });

      this.rbacUserSecret.grantRead(rbacCredentialRotator);
      this.rbacUserSecret.grantWrite(rbacCredentialRotator);
      rbacCredentialRotator.grantInvoke(new iam.ServicePrincipal('secretsmanager.amazonaws.com'))

      this.rbacUserSecret.addRotationSchedule('RotationSchedule', {
        rotationLambda: rbacCredentialRotator,
        automaticallyAfter: props.rotationSchedule
      });

      this.rbacUserSecret.grantRead(rbacCredentialRotator);


    }
  }

}
