const net=require('node:net');
function availablePort(preferred=0) {
  let port=Number.isInteger(preferred)&&preferred>=1024&&preferred<=65535?preferred:0;
  return new Promise((resolve,reject)=>{
    const socket=net.createServer();
    socket.on('error',error=>{if(port&&['EADDRINUSE','EACCES'].includes(error.code)){port=0;socket.listen(0,'127.0.0.1');}else reject(error);});
    socket.listen(port,'127.0.0.1',()=>{const selected=socket.address().port;socket.close(()=>resolve(selected));});
  });
}
module.exports={availablePort};
