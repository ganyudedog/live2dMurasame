param([Parameter(Mandatory)][string]$ChatId, [string]$Profile='murasame-test')
$ErrorActionPreference='Stop'
$exe=(Get-Command lark-cli.cmd).Source
function Invoke-Lark([string[]]$CliArgs) {
    $result = & $exe @CliArgs --profile $Profile | Out-String | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or !$result.ok) { throw ($result.error | ConvertTo-Json -Compress) }
    return $result.data
}
$bot=Invoke-Lark @('api','GET','/open-apis/bot/v3/info','--as','bot')
$marker=[guid]::NewGuid().ToString('N').Substring(0,10)
$text='<at user_id="'+$bot.open_id+'">'+$bot.app_name+'</at> 群聊验收，请回复 '+$marker
$OutputEncoding=[Text.UTF8Encoding]::new($false)
$body=@{text=$text} | ConvertTo-Json -Compress
$sentResult=$body | & $exe im +messages-send --as user --chat-id $ChatId --msg-type text --content - --idempotency-key $marker --profile $Profile | Out-String | ConvertFrom-Json
if (!$sentResult.ok) {throw ($sentResult.error | ConvertTo-Json -Compress)}
$sent=$sentResult.data
$id=$sent.message_id
if (!$id) {throw 'Missing sender receipt'}
Write-Output "Sent $id"
$pathToState=Join-Path $env:APPDATA 'Electron/config/plugins/live2d.feishu.json'
for ($i=0;$i -lt 90;$i++) {
    $state=Get-Content -Encoding utf8 -Raw -LiteralPath $pathToState | ConvertFrom-Json
    $replyId=$state."message.$id".replyMessageId
    if ($replyId) {
        $read=Invoke-Lark @('api','GET',"/open-apis/im/v1/messages/$replyId",'--as','user')
        $item=$read.items[0]
        if ($item.parent_id -ne $id -or $item.chat_id -ne $ChatId -or $item.sender.sender_type -ne 'app') {throw 'Reply identity or destination mismatch'}
        Write-Output "Verified $id -> $replyId in $ChatId";return
    }
    Start-Sleep -Seconds 2
}
throw "No delivery receipt for $id"
