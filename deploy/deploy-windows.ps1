#requires -Version 5.1
<#
仅供审查的保守型 Windows/Jenkins 发布脚本；生成此文件不等于执行发布。

安全边界与限制（审批前必须阅读）：
1. 没有显式 -Approved 立即终止，不检查生产路径、不查询服务、不创建备份。
   -Approved 是人工审批门，不是认证机制；Jenkins 必须另设受保护的审批与凭据权限。
2. Project 仅允许 csd/eksbase，目标和服务写死；BackupRoot 必须为 C:\deployment-backups。
   只支持已有、Running 的 NSSM 服务，应用根目录必须存在。管理员权限必需。
   Workspace 是仓库根目录，必须与两个应用根目录及备份根完全分离。
3. Pipeline 必须预先在工作区完成 npm ci --omit=dev --ignore-scripts，并单独校验
   实际生产 Node 版本、node:sqlite 支持、锁文件及源码可信性。本脚本不运行 npm、Node、
   数据库查询、迁移、同步测试或第二个应用实例，也不声称已完成这些 pipeline 校验。
4. 仅支持无文件删除的初次导入/增量覆盖。目标 src/js/css/node_modules 或受管根文件
   在源中缺失时，停服前拒绝发布，要求另外审批人工迁移，绝不留着旧依赖继续上线。
   不复制工作区 .env、data、logs、.workbuddy-ai 等；发现受管源树含禁止内容即拒绝。
5. 管理员密码只检查生产后端 .env 中对应键非空；从不把 Jenkins 进程变量作为业务配置。
   使用简单 dotenv 子集（export、单行引号、非引号及 # 注释），重复键/多行值拒绝。
   要求 NSSM AppDirectory 指向后端目录、直接启动 node src/server.js；不允许包装器。
   为保证默认 dotenv 非覆盖加载的优先级，拒绝机器级、服务 Environment、NSSM
   AppEnvironment/AppEnvironmentExtra 中管理员键或 NODE_OPTIONS / DOTENV_CONFIG_*。
   不读取/显示 Jenkins 密码，也不输出注册表值或 .env 内容。此策略不支持仅在 NSSM
   存放管理员密码的配置。配置位置为目标 Backend/.env 或 backend/.env，以及
   HKLM:\SYSTEM\CurrentControlSet\Services\<服务>\Parameters 和服务 Environment。
   自定义 dotenv 路径、override、外部凭据加载器须另行审查，不在此脚本支持范围内。
6. 停服务并等待 Stopped 后，完整冷备两个根目录，包括 data/.env/node_modules/日志，
   且逐文件 SHA256 校验备份。备份是敏感数据：仅 SYSTEM/Administrators/当前账户可读写，
   不输出文件列表；要求当前账户是专用部署账户。需要单独的容量、加密和保留策略。
   所有 robocopy 均为 /E /COPY:DAT /DCOPY:DAT /R:1 /W:1，额外 /IS /IT 强制覆盖
   同时间戳/大小文件（防止内容已变却被跳过），退出码 <8 才算成功；
   无 /MIR、/PURGE 或任何删除操作。不会更新 CSD 的 IIS 代理，只更新 EKSBASE web.config。
7. 不提供自动回滚：服务重启可能已修改数据库，简单恢复旧代码或旧数据库并不安全。
   发布前停服/备份失败：尽力恢复全部原服务 Running；不会把失败备份当作有效快照。
   发布写入开始后失败：尽力停止全部服务，保留完整有效冷备与失败现场，非零退出，
   明确要求人工回滚，绝不声称服务已恢复。服务无法停止时同样报告并要求立即人工处理。
   人工恢复必须在确认所有写入者停止后另行审批；不能直接 /E 覆盖回去留下本次新增文件。
8. 健康检查最多六轮，各 GET 超时三秒、失败轮间隔三秒；只接受无重定向的 2xx。
   这些仅验证进程/HTTP 可达，不验证业务集成、数据库语义、认证或静态资源完整性。
9. 要求外部维护窗口、禁止并行源码/生产/备份写入；全局互斥锁只协调本脚本同项目实例。
   EKSBASE 的静态前端由外部 IIS 托管，本脚本不停 IIS，必须在外部隔离访问。
   不改 IIS 绑定、证书、ACL（仅创建/验证备份 ACL）、服务配置或数据库配置。
   应用自身启动时既有的初始化/同步不受本脚本控制，必须在发布审批前单独评估。
10. 拒绝路径祖先/受管源树/完整目标树中的 reparse point，拒绝已识别的硬链接。
    不支持链接/junction、UNC、subst/网络盘、路径别名及恶意并发替换；需要受信任 NTFS
    本地磁盘和受保护目录。路径检查不是抵御本机管理员或 TOCTOU 攻击的沙箱。
    不允许 Jenkins 开启 PowerShell transcript/调试跟踪；底层异常与复制输出均不打印。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('csd', 'eksbase')]
    [string] $Project,

    [Parameter(Mandatory = $true)]
    [string] $Workspace,

    [Parameter(Mandatory = $true)]
    [string] $BackupRoot,

    [switch] $Approved
)

# 必须是首个有运行效果的检查；绝不将未批准调用当成 dry-run。
if (-not $Approved) { throw '未获显式 -Approved 批准；未访问生产目录或服务。' }
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Fail([string] $Message) {
    $errorObject = New-Object InvalidOperationException($Message)
    $errorObject.Data['SafeDeploymentMessage'] = $Message
    throw $errorObject
}

function Get-LocalPath([string] $Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or
        $Path.Substring(2) -match '[:*?"<>|~]' -or $Path -match '[\x00-\x1f]') {
        Fail '拒绝非普通本地绝对路径或路径别名。'
    }
    foreach ($part in ($Path.Substring(3) -split '[\\/]')) {
        if ($part -in @('.', '..') -or $part -match '[ .]$') { Fail '拒绝不规范路径段。' }
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    if ($full.Length -le 3) { Fail '不允许使用磁盘根目录作为操作根。' }
    $drive = New-Object IO.DriveInfo($full.Substring(0, 3))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') {
        Fail '只支持固定本地 NTFS 磁盘。'
    }
    # QueryDosDevice 检查由后续的盘符映射检查完成。
    return $full
}

function Assert-OrdinaryItem([string] $Path, [bool] $Directory) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Fail '检测到 reparse point；拒绝继续。'
    }
    if ($item.PSObject.Properties['LinkType'] -and $item.LinkType) {
        Fail '检测到链接；拒绝继续。'
    }
    if ([bool]$item.PSIsContainer -ne $Directory) { Fail '路径类型与预期不符。' }
}

function Assert-PathAncestors([string] $Path, [bool] $MayBeMissing = $false) {
    $chain = New-Object 'Collections.Generic.Stack[string]'
    $current = $Path
    while ($current) {
        $chain.Push($current)
        $current = [IO.Path]::GetDirectoryName($current)
    }
    # 从盘根向叶子验证，不能先经过未经检查的父 junction 去访问叶子。
    while ($chain.Count -gt 0) {
        $current = $chain.Pop()
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            Assert-OrdinaryItem $current ([bool]$item.PSIsContainer)
            if ($chain.Count -gt 0 -and -not $item.PSIsContainer) { Fail '路径祖先不是目录。' }
        } elseif (-not $MayBeMissing) { Fail '必需路径不存在。' }
    }
}

function Assert-Tree([string] $Root) {
    Assert-PathAncestors $Root
    Assert-OrdinaryItem $Root $true
    # 先检查目录自身，再枚举下一层，绝不递归进入未经检查的 junction。
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force)) {
            Assert-OrdinaryItem $entry.FullName ([bool]$entry.PSIsContainer)
            if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
        }
    }
}

function Test-Inside([string] $Child, [string] $Parent) {
    return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or
        $Child.StartsWith($Parent + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-Separate([string[]] $Paths) {
    for ($i = 0; $i -lt $Paths.Count; $i++) {
        for ($j = $i + 1; $j -lt $Paths.Count; $j++) {
            if ((Test-Inside $Paths[$i] $Paths[$j]) -or (Test-Inside $Paths[$j] $Paths[$i])) {
                Fail '工作区、目标及备份根目录必须完全分离，不能互相嵌套。'
            }
        }
    }
}

function Get-Manifest([string] $Root, [bool] $ManagedSource = $false) {
    Assert-Tree $Root
    $result = @{}
    foreach ($file in @(Get-ChildItem -LiteralPath $Root -Recurse -Force)) {
        $relative = $file.FullName.Substring($Root.Length + 1)
        if ($ManagedSource) {
            foreach ($segment in ($relative -split '\\')) {
                if ($segment -match '^(\.env($|\.)|data$|logs?$|\.workbuddy-ai$|\.git$|\.npmrc$)') {
                    Fail '受管源树含禁止发布的运行时目录或配置文件（含空目录）。'
                }
            }
        }
        if ($file.PSIsContainer) { continue }
        $result[$relative] = [pscustomobject]@{
            Length = $file.Length
            Hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }
    return ,$result
}

function Assert-SameManifest($Expected, $Actual) {
    if ($Expected.Count -ne $Actual.Count) { Fail '文件集合校验失败。' }
    foreach ($key in $Expected.Keys) {
        if (-not $Actual.ContainsKey($key) -or
            $Expected[$key].Length -ne $Actual[$key].Length -or
            $Expected[$key].Hash -ne $Actual[$key].Hash) { Fail '文件完整性校验失败。' }
    }
}

function Invoke-SafeRobocopy([string] $Source, [string] $Destination) {
    Assert-Tree $Source
    Assert-PathAncestors $Destination $true
    if (Test-Path -LiteralPath $Destination) { Assert-Tree $Destination }
    & $script:Robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /IS /IT /XJ /NFL /NDL /NJH /NJS /NP *> $null
    $code = $LASTEXITCODE
    if ($code -lt 0 -or $code -ge 8) { Fail 'robocopy 复制失败；禁止继续发布。' }
}

function Assert-NoEnvironmentOverride($Values, [string] $AdminKey) {
    foreach ($value in @($Values)) {
        if ($null -eq $value) { continue }
        # 注册表的 REG_MULTI_SZ；不输出任何变量名或值。
        foreach ($line in ([string]$value -split "`r?`n")) {
            if ($line -match '^\s*([^=]+)=') {
                $name = $Matches[1].Trim()
                if ($name -ieq $AdminKey -or $name -ieq 'NODE_OPTIONS' -or
                    $name -ilike 'DOTENV_CONFIG_*') { Fail '存在影响 dotenv 优先级的服务或机器环境覆盖；需人工审查。' }
            } elseif (-not [string]::IsNullOrWhiteSpace($line)) {
                Fail '无法安全解释服务环境配置。'
            }
        }
    }
}

function Assert-ProductionDotenv([string] $Path, [string] $Key) {
    Assert-OrdinaryItem $Path $false
    $found = $false
    $nonempty = $false
    $seen = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*(#.*)?$') { continue }
        # 检查整个文件的单行语法，避免把其他多行值中的文本误认作管理员键。
        if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$') {
            Fail '生产 .env 含不受支持的语法；需人工审查。'
        }
        $name = $Matches[1]
        $raw = $Matches[2].Trim()
        if ($seen.ContainsKey($name)) { Fail '生产 .env 含重复键；需人工审查。' }
        $seen[$name] = $true
        $parsed = ''
        if ($raw.StartsWith('"') -or $raw.StartsWith("'")) {
            $quote = $raw.Substring(0, 1)
            $close = $raw.IndexOf($quote, 1)
            if ($close -lt 1 -or $raw.Substring($close + 1) -notmatch '^\s*(#.*)?$') {
                Fail '生产 .env 不属于受支持的单行 dotenv 子集。'
            }
            $parsed = $raw.Substring(1, $close - 1)
        } else {
            if ($raw.StartsWith('`')) { Fail '不支持反引号或多行 dotenv 值。' }
            $parsed = ($raw -split '#', 2)[0].Trim()
        }
        if ($name -ceq $Key) {
            $found = $true
            $nonempty = -not [string]::IsNullOrWhiteSpace($parsed)
        }
        $parsed = $null
        $raw = $null
    }
    if (-not $found -or -not $nonempty) { Fail '生产 .env 缺少非空管理员配置；未使用 Jenkins 环境代替。' }
}

function Assert-ServiceConfiguration([string] $Name, [string] $Directory, [string] $Entry, [string] $AdminKey) {
    $service = Get-Service -Name $Name
    if ($service.Status -ne 'Running') { Fail '必需服务不存在或不是 Running。' }
    $key = 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\' + $Name
    $settings = Get-Item -LiteralPath $key
    $parameters = Get-Item -LiteralPath ($key + '\Parameters')
    $image = [string]$settings.GetValue('ImagePath', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($image -notmatch '^\s*"?([A-Za-z]:\\[^"\r\n]*?\\nssm\.exe)"?\s*$') {
        Fail '服务不是受支持的直接 NSSM 服务。'
    }
    $nssm = Get-LocalPath $Matches[1]
    Assert-PathAncestors $nssm
    Assert-OrdinaryItem $nssm $false
    $app = [string]$parameters.GetValue('Application', '')
    $appDir = [string]$parameters.GetValue('AppDirectory', '')
    $arguments = [string]$parameters.GetValue('AppParameters', '')
    $node = Get-LocalPath $app
    if ([IO.Path]::GetFileName($node) -ine 'node.exe' -or
        (Get-LocalPath $appDir) -ine $Directory -or
        $arguments.Trim().Replace('/', '\') -notin @($Entry, ('"' + $Entry + '"'))) {
        Fail 'NSSM 必须使用预期工作目录并直接运行约定的 Node 入口。'
    }
    Assert-PathAncestors $node
    Assert-OrdinaryItem $node $false
    Assert-NoEnvironmentOverride ($parameters.GetValue('AppEnvironment', @())) $AdminKey
    Assert-NoEnvironmentOverride ($parameters.GetValue('AppEnvironmentExtra', @())) $AdminKey
    Assert-NoEnvironmentOverride ($settings.GetValue('Environment', @())) $AdminKey
}

function Wait-ServiceStatus([string] $Name, [string] $Status) {
    $service = Get-Service -Name $Name
    $service.WaitForStatus($Status, [TimeSpan]::FromSeconds(30))
    $service.Refresh()
    if ($service.Status.ToString() -ne $Status) { Fail '服务状态未达到预期。' }
}

function Stop-AllServices([string[]] $Names) {
    $ok = $true
    foreach ($name in $Names) {
        try {
            $service = Get-Service -Name $name
            if ($service.Status -ne 'Stopped' -and $service.Status -ne 'StopPending') {
                Stop-Service -Name $name -ErrorAction Stop -WarningAction SilentlyContinue
            }
            Wait-ServiceStatus $name 'Stopped'
        } catch { $ok = $false }
    }
    return $ok
}

function Restore-Running([string[]] $Names) {
    $ok = $true
    # 后端先恢复；不运行独立应用实例。
    foreach ($name in $Names) {
        try {
            $service = Get-Service -Name $name
            if ($service.Status -eq 'StopPending') { Wait-ServiceStatus $name 'Stopped' }
            $service = Get-Service -Name $name
            if ($service.Status -ne 'Running' -and $service.Status -ne 'StartPending') {
                Start-Service -Name $name -WarningAction SilentlyContinue
            }
            Wait-ServiceStatus $name 'Running'
        } catch { $ok = $false }
    }
    return $ok
}

function Assert-Healthy([string[]] $Urls, [string[]] $Names) {
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $ok = $true
        foreach ($name in $Names) {
            if ((Get-Service -Name $name).Status -ne 'Running') { $ok = $false }
        }
        foreach ($url in $Urls) {
            $response = $null
            try {
                $request = [Net.HttpWebRequest]::Create($url)
                $request.Method = 'GET'
                $request.Proxy = $null
                $request.AllowAutoRedirect = $false
                $request.Timeout = 3000
                $request.ReadWriteTimeout = 3000
                $request.KeepAlive = $false
                $response = $request.GetResponse()
                $code = [int]$response.StatusCode
                if ($code -lt 200 -or $code -ge 300) { $ok = $false }
            } catch { $ok = $false }
            finally { if ($null -ne $response) { $response.Dispose() } }
        }
        if ($ok) { return }
        if ($attempt -lt 6) { Start-Sleep -Seconds 3 }
    }
    Fail '服务状态或本地 HTTP 健康检查失败；未验证业务集成。'
}

function Get-BackupSecurity {
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in $script:AllowedBackupSids) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $security.AddAccessRule($rule)
    }
    return $security
}

function Assert-BackupSecurity([string] $Path) {
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) { Fail '备份根 ACL 必须禁用继承并限制访问。' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $script:AllowedBackupSids) {
        Fail '备份根所有者不属于允许的部署主体。'
    }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and
            $rule.IdentityReference.Value -notin $script:AllowedBackupSids) {
            Fail '备份根 ACL 向非部署主体开放；需管理员预先收紧权限。'
        }
    }
}

$mutex = $null
$locked = $false
$stopAttempted = $false
$productionTouched = $false
$backupVerified = $false
$batch = $null
$phase = '初始化'
$services = @()

try {
    if ($env:OS -ne 'Windows_NT') { Fail '此脚本仅适用于 Windows。' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Fail '需要管理员权限。'
    }
    $script:AllowedBackupSids = @('S-1-5-18', 'S-1-5-32-544', $identity.User.Value) | Select-Object -Unique
    $workspacePath = Get-LocalPath $Workspace
    $backupPath = Get-LocalPath $BackupRoot
    if ($backupPath -ine 'C:\deployment-backups') { Fail 'BackupRoot 必须是独立的 C:\deployment-backups。' }

    if ($Project -eq 'csd') {
        $backend = 'D:\Customer_Store_Dashboard\Backend'
        $frontend = 'D:\Customer_Store_Dashboard\Frontend'
        $backendName = 'Backend'
        $frontendName = 'Frontend'
        $adminKey = 'CSD_ADMIN_PASSWORD'
        $services = @('CSDashboardBackend', 'CSDashboardFrontend')
        $urls = @('http://127.0.0.1:3002/health', 'http://127.0.0.1:3003/')
        $frontFiles = @('index.html', 'server.js')
    } else {
        $backend = 'C:\apps\eksbase\backend'
        $frontend = 'C:\apps\eksbase\frontend'
        $backendName = 'backend'
        $frontendName = 'frontend'
        $adminKey = 'EKSBASE_ADMIN_PASSWORD'
        $services = @('EKSBASE-Backend')
        $urls = @('http://127.0.0.1:3000/health')
        $frontFiles = @('index.html', 'web.config')
    }
    $backend = Get-LocalPath $backend
    $frontend = Get-LocalPath $frontend
    Assert-Separate @($workspacePath, $backend, $frontend, $backupPath)

    # 拒绝 SUBST 映射；不执行 shell 命令，不从 PATH 解析系统工具。
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DeploymentDriveMapping {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint QueryDosDevice(string name, StringBuilder target, int size);
}
'@
    foreach ($drive in (@($workspacePath, $backend, $frontend, $backupPath) | ForEach-Object { $_.Substring(0, 2) } | Select-Object -Unique)) {
        $buffer = New-Object Text.StringBuilder(4096)
        if ([DeploymentDriveMapping]::QueryDosDevice($drive, $buffer, $buffer.Capacity) -eq 0 -or
            $buffer.ToString() -notmatch '^\\Device\\HarddiskVolume[0-9]+$') {
            Fail '拒绝别名、SUBST 或非普通本地卷映射。'
        }
    }
    $mutex = New-Object Threading.Mutex($false, ('Global\SafeDeploy-' + $Project))
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] {
        $locked = $true
        Fail '发现上次部署异常中断；必须先人工确认服务与备份状态。'
    }
    if (-not $locked) { Fail '同项目已有部署实例。' }

    $phase = '部署前校验'
    # 脚本权限不能替代 Jenkins 的审批门或维护窗口。
    Assert-PathAncestors $workspacePath
    Assert-OrdinaryItem $workspacePath $true
    Assert-Tree $backend
    Assert-Tree $frontend
    Assert-PathAncestors $backupPath $true
    if (Test-Path -LiteralPath $backupPath) {
        Assert-OrdinaryItem $backupPath $true
        Assert-BackupSecurity $backupPath
    }
    $script:Robocopy = Join-Path ([Environment]::GetFolderPath('System')) 'robocopy.exe'
    Assert-PathAncestors $script:Robocopy
    Assert-OrdinaryItem $script:Robocopy $false

    $machine = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Machine)
    foreach ($key in $machine.Keys) {
        if ($key -ieq $adminKey -or $key -ieq 'NODE_OPTIONS' -or $key -ilike 'DOTENV_CONFIG_*') {
            Fail '机器环境会影响生产 dotenv 优先级；需人工审查。'
        }
    }
    Assert-ServiceConfiguration $services[0] $backend 'src\server.js' $adminKey
    if ($Project -eq 'csd') {
        Assert-ServiceConfiguration $services[1] $frontend 'server.js' $adminKey
    }
    Assert-ProductionDotenv (Join-Path $backend '.env') $adminKey

    $sourceBack = Join-Path $workspacePath $backendName
    $sourceFront = Join-Path $workspacePath $frontendName
    Assert-PathAncestors $sourceBack
    Assert-PathAncestors $sourceFront
    Assert-OrdinaryItem $sourceBack $true
    Assert-OrdinaryItem $sourceFront $true
    Assert-OrdinaryItem (Join-Path $sourceBack 'package.json') $false
    Assert-OrdinaryItem (Join-Path $sourceBack 'package-lock.json') $false
    Assert-Tree (Join-Path $sourceBack 'src')
    Assert-OrdinaryItem (Join-Path $sourceBack 'src\server.js') $false
    $modules = Join-Path $sourceBack 'node_modules'
    Assert-Tree $modules
    if (@(Get-ChildItem -LiteralPath $modules -Force -File -Recurse).Count -eq 0) {
        Fail '工作区 node_modules 为空；须由 pipeline 安装并校验。'
    }

    $units = @()
    foreach ($relative in @('src', 'node_modules')) {
        $units += [pscustomobject]@{ Source = (Join-Path $sourceBack $relative); Target = (Join-Path $backend $relative); Directory = $true; Manifest = $null }
    }
    foreach ($relative in @('js', 'css')) {
        $units += [pscustomobject]@{ Source = (Join-Path $sourceFront $relative); Target = (Join-Path $frontend $relative); Directory = $true; Manifest = $null }
    }
    $packageFiles = @(Get-ChildItem -LiteralPath $sourceBack -Filter 'package*.json' -Force -File)
    foreach ($targetPackage in @(Get-ChildItem -LiteralPath $backend -Filter 'package*.json' -Force -File)) {
        if ($targetPackage.Name -notin @($packageFiles | ForEach-Object { $_.Name })) {
            Fail '目标受管 package 文件已从源中删除；要求单独审批人工迁移。'
        }
    }
    foreach ($file in $packageFiles) {
        $units += [pscustomobject]@{ Source = $file.FullName; Target = (Join-Path $backend $file.Name); Directory = $false; Manifest = $null }
    }
    foreach ($file in $frontFiles) {
        $units += [pscustomobject]@{ Source = (Join-Path $sourceFront $file); Target = (Join-Path $frontend $file); Directory = $false; Manifest = $null }
    }
    foreach ($unit in $units) {
        Assert-PathAncestors $unit.Source
        Assert-OrdinaryItem $unit.Source $unit.Directory
        Assert-PathAncestors $unit.Target $true
        if ($unit.Directory) {
            $unit.Manifest = Get-Manifest $unit.Source $true
            if ($unit.Manifest.Count -eq 0) { Fail '受管源目录为空；拒绝不明确的导入。' }
            if (Test-Path -LiteralPath $unit.Target) {
                $old = Get-Manifest $unit.Target
                foreach ($relative in $old.Keys) {
                    if (-not $unit.Manifest.ContainsKey($relative)) {
                        Fail '目标源码或依赖文件在源中缺失；无删除发布不适用，要求人工迁移。'
                    }
                }
            }
        } else {
            if (Test-Path -LiteralPath $unit.Target) { Assert-OrdinaryItem $unit.Target $false }
            $unit.Manifest = (Get-FileHash -LiteralPath $unit.Source -Algorithm SHA256).Hash
        }
    }

    # 所有必需条件已通过，才创建敏感备份位置、停止服务。
    $phase = '准备冷备'
    if (-not (Test-Path -LiteralPath $backupPath)) {
        [void][IO.Directory]::CreateDirectory($backupPath, (Get-BackupSecurity))
    }
    Assert-BackupSecurity $backupPath
    $batch = Join-Path $backupPath ($Project + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $batch) { Fail '备份批次意外存在；拒绝覆盖。' }
    [void][IO.Directory]::CreateDirectory($batch, (Get-BackupSecurity))
    Assert-Tree $batch
    Assert-BackupSecurity $batch
    Write-Host ('预检通过；敏感备份批次：' + $batch)

    # 在停服前最后复核原服务状态；任何非 Running 状态都不接管。
    foreach ($name in $services) {
        if ((Get-Service -Name $name).Status -ne 'Running') { Fail '停服前状态发生变化，部署已阻断。' }
    }
    $phase = '停止服务'
    $stopAttempted = $true
    $stopOrder = @($services)
    [array]::Reverse($stopOrder)
    if (-not (Stop-AllServices $stopOrder)) { Fail '停服失败。' }
    $phase = '完整冷备与校验'
    foreach ($root in @($backend, $frontend)) {
        $snapshot = Get-Manifest $root
        $destination = Join-Path $batch ([IO.Path]::GetFileName($root))
        Invoke-SafeRobocopy $root $destination
        Assert-SameManifest $snapshot (Get-Manifest $destination)
        Assert-SameManifest $snapshot (Get-Manifest $root)
    }
    foreach ($name in $services) {
        if ((Get-Service -Name $name).Status -ne 'Stopped') { Fail '冷备期间服务被外部启动，快照不可用于恢复。' }
    }
    $backupVerified = $true
    Write-Host ('完整冷备已校验：' + $batch)

    # 冷备期间源代码不能变化；修改前再次检查树与文件缺失约束。
    $phase = '发布前最终复核'
    foreach ($root in @($backend, $frontend)) { Assert-Tree $root }
    Assert-ProductionDotenv (Join-Path $backend '.env') $adminKey
    foreach ($unit in $units) {
        if ($unit.Directory) {
            Assert-SameManifest $unit.Manifest (Get-Manifest $unit.Source $true)
            if (Test-Path -LiteralPath $unit.Target) {
                $old = Get-Manifest $unit.Target
                foreach ($relative in $old.Keys) {
                    if (-not $unit.Manifest.ContainsKey($relative)) { Fail '备份期间目标受管文件发生变化。' }
                }
            }
        } else {
            Assert-PathAncestors $unit.Source
            if ((Get-FileHash -LiteralPath $unit.Source -Algorithm SHA256).Hash -ne $unit.Manifest) {
                Fail '备份期间工作区发生变化。'
            }
        }
    }
    foreach ($name in $services) {
        if ((Get-Service -Name $name).Status -ne 'Stopped') { Fail '冷备期间服务被外部启动；禁止发布。' }
    }

    $phase = '白名单覆盖发布'
    # 在第一个可能写入生产的调用前置位；即使部分复制失败也必须进入停服人工恢复分支。
    $productionTouched = $true
    foreach ($unit in $units) {
        if ($unit.Directory) {
            Invoke-SafeRobocopy $unit.Source $unit.Target
            Assert-SameManifest $unit.Manifest (Get-Manifest $unit.Target)
        } else {
            Assert-PathAncestors $unit.Target $true
            if (Test-Path -LiteralPath $unit.Target) { Assert-OrdinaryItem $unit.Target $false }
            Copy-Item -LiteralPath $unit.Source -Destination $unit.Target -Force
            if ((Get-FileHash -LiteralPath $unit.Target -Algorithm SHA256).Hash -ne $unit.Manifest) {
                Fail '受管根文件发布校验失败。'
            }
        }
    }
    $phase = '启动服务及健康检查'
    if (-not (Restore-Running $services)) { Fail '服务未全部恢复 Running。' }
    Assert-Healthy $urls $services
    foreach ($name in $services) {
        if ((Get-Service -Name $name).Status -ne 'Running') { Fail '最终服务状态不是 Running。' }
    }
    Write-Host ('发布成功：' + $Project + '；服务 Running，本地 HTTP 通过；未验证业务集成。')
    Write-Host ('完整冷备保留于：' + $batch)
} catch {
    # 不打印 $_ / Exception / InvocationInfo：底层异常可能带路径、环境或文件内容。
    Write-Host ('部署失败；阶段：' + $phase + '。底层错误已隐去，禁止以本次结果继续流水线。')
    if ($_.Exception.Data.Contains('SafeDeploymentMessage')) {
        Write-Host ([string]$_.Exception.Data['SafeDeploymentMessage'])
    }
    if ($productionTouched) {
        $stopOrder = @($services)
        [array]::Reverse($stopOrder)
        if (Stop-AllServices $stopOrder) {
            Write-Host '失败后所有受管服务已停止；没有执行自动回滚，必须人工审批恢复。'
        } else {
            Write-Host '严重：无法确认所有受管服务已停止，可能运行混合版本；必须立即人工隔离并处理。'
        }
        if ($backupVerified) { Write-Host ('已校验完整冷备：' + $batch + '；失败产物仍留在生产目录，未删除。') }
    } elseif ($stopAttempted) {
        if (Restore-Running $services) {
            Write-Host '生产应用文件未修改；原服务已尽力恢复并确认 Running（未声明业务健康）。'
        } else {
            Write-Host '严重：生产应用文件未修改，但原服务未全部恢复 Running；必须立即人工处理。'
        }
        if ($null -ne $batch) { Write-Host ('备份批次：' + $batch + '；只有备份校验完成的批次才可考虑用于人工恢复。') }
    }
    throw '部署未完成；安全中止。请查看上述阶段和服务状态，不得自动重试或宣称回滚成功。'
} finally {
    if ($locked -and $null -ne $mutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
