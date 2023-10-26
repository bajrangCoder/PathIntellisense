var f={id:"bajrangcoder.path.intellize",name:"PathIntellisense",main:"dist/main.js",version:"1.0.6",readme:"readme.md",icon:"icon.png",files:[],minVersionCode:290,price:0,author:{name:"Raunak Raj",email:"bajrangcoders@gmail.com",github:"bajrangCoder"}};var m=class{constructor(){this.cache=new Map,this.accessOrder=[]}async getAsync(e){return this.cache.has(e)?(this.accessOrder=this.accessOrder.filter(t=>t!==e),this.accessOrder.unshift(e),this.cache.get(e)):null}async setAsync(e,t){if(this.cache.size>=20){let n=this.accessOrder.pop();this.cache.delete(n)}this.cache.set(e,t),this.accessOrder.unshift(e)}resetCache(){this.cache.clear(),this.accessOrder=[]}},p=m;var w=acode.require("fsOperation"),{editor:g}=editorManager,C=class{constructor(){this.directoryCache=new p}async init(){let e=this;editorManager.editor.commands.addCommand({name:"pathintellisense:reset_cache",description:"Reset PathIntellisense Cache",bindKey:{win:"Ctrl-Shift-I"},exec:this.clearCache.bind(this)}),g.completers.push({getCompletions:async function(t,n,i,r,o){let d=n.getLine(i.row),s=e.getCurrentInput(d,i.column);if(!editorManager.activeFile.uri)return;let a="$HOME/",u=e.removeFileNameAndExtension(editorManager.activeFile.uri);if(s.startsWith(a)){let c="content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome::/data/data/com.termux/files/home/"+s.substring(a.length)||"";await e.fetchDirectoryContents(c,o,!1)}else if(s.startsWith("/")){let l=u,c=e.resolveRelativePath(l,s);await e.fetchDirectoryContents(c,o,!1)}else if(s.startsWith("../")){let l=u,c=e.resolveRelativePath(l,s);await e.fetchDirectoryContents(c,o,!1)}else if(s.startsWith("./")){let l=u,c=e.resolveRelativePath(l,s.substring(1));await e.fetchDirectoryContents(c,o,!1)}else await e.fetchDirectoryContents(u,o,!0)}}),g.commands.on("afterExec",function(t){t.command.name==="insertstring"&&(t.args==="/"||t.args.endsWith("/"))&&g.execCommand("startAutocomplete")})}clearCache(){this.directoryCache.resetCache(),window.toast("Cache Cleared \u{1F525}",2e3)}async fetchDirectoryContents(e,t,n){try{let i=acode.require("helpers"),r=await this.directoryCache.getAsync(e);if(r){t(null,r);return}let d=(await w(e).lsDir()).map(function(s){let a={caption:s.name,value:s.name,score:n?500:8e3,meta:s.isFile?"File":"Folder"};return extraSyntaxHighlightsInstalled&&(a.icon=s.isFile?i.getIconForFile(s.name):"icon folder"),s.isFile||(a.value+="/"),a});await this.directoryCache.setAsync(e,d),t(null,d)}catch(i){t(null,[]),console.log(i)}}getCurrentInput(e,t){let n="",i=t-1;for(;i>=0&&/[a-zA-Z0-9/.+_\-\s$\:]/.test(e[i]);)n=e[i]+n,i--;return n}resolveRelativePath(e,t){if(t.startsWith("/"))return e+t;let n=e.split("::");if(n.length===2){let i=n[0],r=n[1];r.endsWith("/")||(r+="/");let o=t.split("/");for(let s of o)if(s===".."){let a=r.lastIndexOf("/",r.length-2);a!==-1&&(r=r.substring(0,a+1))}else s!=="."&&s!==""&&(r+=s+"/");return i+"::"+r}return e}removeFileNameAndExtension(e){let t=e.lastIndexOf("/"),n=e.substring(t+1);return e.substring(0,e.length-n.length-1)}async destroy(){editorManager.editor.commands.removeCommand("pathintellisense:reset_cache")}};if(window.acode){let h=new C;acode.setPluginInit(f.id,async(e,t,{cacheFileUrl:n,cacheFile:i})=>{e.endsWith("/")||(e+="/"),h.baseUrl=e,await h.init(t,i,n)}),acode.setPluginUnmount(f.id,()=>{h.destroy()})}
