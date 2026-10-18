pipeline {
    agent { label 'windows-iis-deploy' }
    options {
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }
    parameters {
        booleanParam(name: 'DEPLOY_PRODUCTION', defaultValue: false,
            description: 'Default validates only. Production requires a separate approval and maintenance window.')
    }
    triggers { pollSCM('H/5 * * * *') }
    stages {
        stage('Checkout') { steps { checkout scm } }
        stage('Validate and install locked dependencies') {
            steps {
                powershell '.\\deploy\\validate-windows.ps1'
            }
        }
        stage('Production approval') {
            when { expression { params.DEPLOY_PRODUCTION } }
            options { timeout(time: 30, unit: 'MINUTES') }
            steps {
                input message: 'Confirm maintenance window, unique administrator password, backup capacity, and manual recovery owner. EKSBASE startup may trigger synchronization. Continue?', ok: 'Approve production release'
            }
        }
        stage('Deploy production') {
            when { expression { params.DEPLOY_PRODUCTION } }
            steps {
                powershell '.\\deploy\\deploy-windows.ps1 -Project csd -Workspace $env:WORKSPACE -BackupRoot "C:\\deployment-backups" -Approved'
            }
        }
    }
    post {
        success { echo 'Selected stages passed. Validation-only builds do not deploy. HTTP checks are not business integration tests.' }
        failure { echo 'Build failed. If release writes began, inspect retained cold backup and arrange manual recovery; never assume automatic rollback.' }
    }
}
