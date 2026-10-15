// Product workflows use these wrappers; standalone adapter callers remain explicit.
import {MediaLibrary,type MediaRequest,type MediaOwner} from '../media-library';
import {generateCodexImage,type CodexImageOptions} from './codex-image';
import {renderHyperframes} from '../render/hyperframes';
// Adapter injection is source-only, never populated from model/HTTP parameters.
export function mediaJobs(library:MediaLibrary,adapters={image:generateCodexImage,video:renderHyperframes}){return{
 image(request:MediaRequest,owner:MediaOwner,input:CodexImageOptions){if(request.type!=='image'||request.origin!=='generated'||request.provider!=='codex'||request.model!==input.approved.model)throw new Error('Image publisher identity differs');return library.run(request,owner,async()=>{const result=await adapters.image({...input,signal:owner.signal,authorize:owner.authorize});if(result.model!==request.model||result.provider!==request.provider)throw new Error('Actual image producer differs');return{bytes:result.bytes,mime:result.mime};});},
 video(request:MediaRequest,owner:MediaOwner,input:Parameters<typeof renderHyperframes>[0]){if(request.type!=='video'||request.origin!=='generated'||request.provider!=='hyperframes')throw new Error('Video publisher identity differs');return library.run(request,owner,async()=>{const result=await adapters.video({...input,signal:owner.signal,authorize:owner.authorize});if(request.model!==result.renderer)throw new Error('Actual video renderer differs');return{bytes:result.bytes,mime:'video/mp4',...((result as any).poster?{poster:(result as any).poster}:{})};});},
};}
