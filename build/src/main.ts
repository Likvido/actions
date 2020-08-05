import {setFailed, getInput} from '@actions/core'
import {env} from 'process'
import * as shell from 'shelljs'
import {publishResults, UploadOptions} from 'nunit-result/src/publish-results'

async function run(): Promise<void> {
  const wd = process.cwd()
  try {
    const imageName = getInput('image-name')
    const dockerFilePath = getInput('docker-file-path')
    const deploymentPath = getInput('deployment-path')
    const workingDirectory = getInput('working-directory')
    const principalId = getInput('principal-id')
    const principalPassword = getInput('principal-password')
    const principalTenant = getInput('principal-tenant')
    const registry = getInput('registry')
    const aksCluster = getInput('aks-cluster')
    const aksClusterResouceGroup = getInput('aks-cluster-resource-group')

    process.chdir(workingDirectory)

    let res = shell.exec(`docker build -t ${imageName} -f ${dockerFilePath} .`)

    //try to upload tests results before checking the code
    await uploadTestResults()

    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }

    res = shell.exec(
      `echo ${principalPassword} | docker login -u ${principalId} --password-stdin ${registry}.azurecr.io`
    )
    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }

    res = shell.exec(`docker push ${imageName}`)
    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }

    res = shell.exec(
      `az login --service-principal --tenant ${principalTenant} -u ${principalId} -p ${principalPassword}`
    )
    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }

    res = shell.exec(
      `az aks get-credentials -n ${aksCluster} -g ${aksClusterResouceGroup}`
    )
    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }

    res = shell.exec(`sed -i 's|<IMAGE>|${imageName}|' ${deploymentPath}`)
    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }

    res = shell.exec(`kubectl apply -f ${deploymentPath} --record`)
    if (res.code !== 0) {
      setFailed(res.stderr)
      return
    }
  } catch (error) {
    setFailed(error.message)
  } finally {
    process.chdir(wd)
  }
}

async function uploadTestResults(): Promise<void> {
  const testsLabel = getInput('tests-label')
  const accessToken = getInput('access-token')
  const srcReplacement = getInput('src-replacement')
  const testReportName = getInput('tests-report-name')
  const containerName = 'testcontainer'
  if (testsLabel == null || testsLabel === '') {
    return
  }

  let res = shell.exec(
    `docker create --name ${containerName} $(docker images --filter "label=${testsLabel}" -q | head -1)`
  )
  if (res.code !== 0) {
    throw new Error(res.stderr)
  }
  const workspacePath = env['GITHUB_WORKSPACE']
  const testResultsPath = `${workspacePath}/test-results`

  res = shell.exec(
    `docker cp ${containerName}:/app/test-results ${testResultsPath}`
  )
  if (res.code !== 0) {
    throw new Error(res.stderr)
  }

  shell.exec(`docker rm ${containerName}`) //ignore if error

  const options = new UploadOptions(
    `${testResultsPath}/*.xml`,
    accessToken,
    testReportName,
    30,
    srcReplacement
  )
  await publishResults(options)
}

run()
