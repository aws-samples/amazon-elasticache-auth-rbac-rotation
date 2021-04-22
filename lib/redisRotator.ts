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
import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');
import kms = require('@aws-cdk/aws-kms');
import elasticache = require('@aws-cdk/aws-elasticache');
import lambda = require('@aws-cdk/aws-lambda');
import secretsmanager = require('@aws-cdk/aws-secretsmanager')
import path = require('path');
import { RedisRbacUser } from './redisRbacUser';

interface singleAuthRedisProps{
  replicationGroupId: string,
  elasticacheSubnetGroup: elasticache.CfnSubnetGroup,
  elasticacheSecurityGroupIds: string[],
  rotatorFunctionSecurityGroups: ec2.SecurityGroup[],
  rotationSchedule: cdk.Duration,
  rotatorVpc: ec2.Vpc
}

interface rbacRedisProps{
  replicationGroupId: string,
  elasticacheSubnetGroupName: string,
  elasticacheSecurityGroupIds: string[],
  rotatorFunctionSecurityGroups: ec2.SecurityGroup[],
  rotationSchedule: cdk.Duration,
  rotatorVpc: ec2.Vpc
}

export class RedisRbacRotation extends cdk.Construct{

  constructor(scope: cdk.Construct, id: string, props: rbacRedisProps) {
    super(scope, id);

    const testUserName = 'rotationtestuser'

    const redisPyLayer = new lambda.LayerVersion(this, 'redispy_Layer', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/lambda_layer/redis_py.zip')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_8, lambda.Runtime.PYTHON_3_7, lambda.Runtime.PYTHON_3_6],
      description: 'A layer that contains the redispy module',
      license: 'MIT License'
    });


    const testUserRole = new iam.Role(this, testUserName+'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role to be assumed by producer lambda',
    });

    testUserRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    testUserRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"));

    const testUser = new RedisRbacUser(this, "TestUser", {
      redisUserName: 'rotator-demo/rotationtestuser',
      redisUserId: 'rotationtestuser',
      accessString: 'on ~* -@all +SET',
      principals: [testUserRole],
      redisPyLayer: [redisPyLayer],
      rotationSchedule: props.rotationSchedule,
      rotatorFunctionVpc: props.rotatorVpc,
      rotatorFunctionSecurityGroups: props.rotatorFunctionSecurityGroups
    });

    const anotherUser = new RedisRbacUser(this, "AnotherUser", {
      redisUserName: 'rotator-demo/anothertestuser',
      redisUserId: 'anotherrotationtestuser',
      accessString: 'on ~* -@all +SET',
      principals: [testUserRole],
      redisPyLayer: [redisPyLayer],
      rotationSchedule: props.rotationSchedule,
      rotatorFunctionVpc: props.rotatorVpc,
      rotatorFunctionSecurityGroups: props.rotatorFunctionSecurityGroups
    });

    const groupDefaultRbacUser = new RedisRbacUser(this, "groupDefaultUser", {
      redisUserName: 'default',
      redisUserId: 'rotatordemodefaultuser',
    });

    const rotationTestUserGroup = new elasticache.CfnUserGroup(this, 'rotationTestUserGroup', {
      engine: 'redis',
      userGroupId: 'rotation-test-group',
      // userIds: [testUser.getUserId(), groupDefaultRbacUser.getUserId(), anotherUser.getUserId()]
      userIds: [groupDefaultRbacUser.getUserId()]
    })

    rotationTestUserGroup.node.addDependency(groupDefaultRbacUser);

    const ecClusterReplicationGroup = new elasticache.CfnReplicationGroup(this, 'RBACRotator-Demo', {
      replicationGroupDescription: 'RBACRotator-Demo',
      atRestEncryptionEnabled: true,
      multiAzEnabled: true,
      cacheNodeType: 'cache.m6g.large',
      cacheSubnetGroupName: props.elasticacheSubnetGroupName,
      engine: "Redis",
      engineVersion: '6.x',
      numNodeGroups: 1,
      // kmsKeyId: elastiCacheKmsKey.keyId,
      replicasPerNodeGroup: 1,
      securityGroupIds: props.elasticacheSecurityGroupIds,
      transitEncryptionEnabled: true,
      userGroupIds: [rotationTestUserGroup.userGroupId]
    })

    ecClusterReplicationGroup.node.addDependency(rotationTestUserGroup)

  }



};

export class RedisSingleAuthRotation extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: singleAuthRedisProps) {

    super(scope, id);

    const secret = new secretsmanager.Secret(this, 'RedisAuth', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ 'replicationGroupId' : props.replicationGroupId }),
        generateStringKey: 'authToken',
        excludeCharacters: '@%*()_+=`~{}|[]\\:";\'?,./'
      },
    });

    const ecClusterReplicationGroup = new elasticache.CfnReplicationGroup(this, 'RedisReplicationGroup', {
      replicationGroupDescription: 'RedisReplicationGroup-RBAC-Demo',
      replicationGroupId: props.replicationGroupId,
      atRestEncryptionEnabled: true,
      multiAzEnabled: true,
      cacheNodeType: 'cache.m4.large',
      cacheSubnetGroupName: props.elasticacheSubnetGroup.ref,
      engine: "Redis",
      engineVersion: '6.x',
      numNodeGroups: 1,
      replicasPerNodeGroup: 1,
      securityGroupIds: props.elasticacheSecurityGroupIds,
      transitEncryptionEnabled: true,
      authToken: secret.secretValueFromJson('authToken').toString()
    })

    // ecClusterReplicationGroup.node.addDependency(redisAuthToken)
    const rotatorRole = new iam.Role(this, 'rotatorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role to be assumed by producer  lambda',
    });

    rotatorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    rotatorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"));
    rotatorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [secret.secretArn],
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
        resources: ["arn:aws:elasticache:"+cdk.Stack.of(this).region+":"+cdk.Stack.of(this).account+":replicationgroup:"+props.replicationGroupId.toLowerCase()],
        actions: [
          "elasticache:DescribeReplicationGroups",
          "elasticache:ModifyReplicationGroup"
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

    const redisPyLayer = new lambda.LayerVersion(this, 'redispy_Layer', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/lambda_layer/redis_py.zip')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_8, lambda.Runtime.PYTHON_3_7, lambda.Runtime.PYTHON_3_6],
      description: 'A layer that contains the redispy module',
      license: 'MIT License'
    });

    const rotatorFunction = new lambda.Function(this, 'function', {
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'lambda_handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/lambda_rotator')),
      layers: [redisPyLayer],
      role: rotatorRole,
      timeout: cdk.Duration.seconds(30),
      vpc: props.rotatorVpc,
      vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE},
      securityGroups: props.rotatorFunctionSecurityGroups,
      environment: {
        replicationGroupId: ecClusterReplicationGroup.ref,
        redis_endpoint: ecClusterReplicationGroup.attrPrimaryEndPointAddress,
        redis_port: ecClusterReplicationGroup.attrPrimaryEndPointPort,
        EXCLUDE_CHARACTERS: '@%*()_+=`~{}|[]\\:";\'?,./',
        SECRETS_MANAGER_ENDPOINT: "https://secretsmanager."+cdk.Stack.of(this).region+".amazonaws.com"
      }
    });

    secret.addRotationSchedule('RotationSchedule', {
      rotationLambda: rotatorFunction,
      automaticallyAfter: props.rotationSchedule
    });

    secret.grantRead(rotatorFunction);

    rotatorFunction.grantInvoke(new iam.ServicePrincipal('secretsmanager.amazonaws.com'))

    const testerLambdaRole = new iam.Role(this, 'testerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role to be assumed by producer  lambda',
    });

    testerLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    testerLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"));
    testerLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [secret.secretArn],
        actions: [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue"
        ]
      })
    );

    const connectionTestFunction = new lambda.Function(this, 'connectionTestFunction', {
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'lambda_tester.lambda_handler_single_auth',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/lambda_tester')),
      layers: [redisPyLayer],
      role: testerLambdaRole,
      timeout: cdk.Duration.seconds(30),
      vpc: props.rotatorVpc,
      vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE},
      securityGroups: props.rotatorFunctionSecurityGroups,
      environment: {
        replicationGroupId: ecClusterReplicationGroup.ref,
        redis_endpoint: ecClusterReplicationGroup.attrPrimaryEndPointAddress,
        redis_port: ecClusterReplicationGroup.attrPrimaryEndPointPort,
        secret_arn: secret.secretArn,
      }
    });

    secret.grantRead(connectionTestFunction);

  }
}