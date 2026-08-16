from pathlib import Path

path = Path('web-admin/src/main.js')
text = path.read_text()
old = "async function downloadLog(id){try{setBusy(true,'Đang tạo link tải log…');const r=await api('download-log',{id});location.href=r.url;}catch(error){alert(safeMessage(error));}finally{setBusy(false);}}"
new = """async function downloadLog(id){
  try{
    setBusy(true,'Đang tải log…');
    const r=await api('download-log',{id});
    if(!r.gzip_base64)throw new Error('Máy chủ không trả dữ liệu log.');
    const raw=atob(r.gzip_base64),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/gzip'}));
    const link=document.createElement('a');
    link.href=url;link.download=r.file_name||`bao-hang-1291-log-${id}.jsonl.gz`;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert(safeMessage(error));}
  finally{setBusy(false);}
}"""
if old in text:
    if text.count(old) != 1:
        raise SystemExit(f'downloadLog legacy marker count={text.count(old)}')
    text = text.replace(old, new, 1)
elif "if(!r.gzip_base64)throw new Error('Máy chủ không trả dữ liệu log.');" not in text:
    raise SystemExit('downloadLog compatibility marker not found')
path.write_text(text)
