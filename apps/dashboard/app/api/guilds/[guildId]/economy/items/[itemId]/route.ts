import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../../lib/auth";

const upstream=(guildId:string,id:string)=>new URL(
  `/api/guilds/${encodeURIComponent(guildId)}/economy/items/${encodeURIComponent(id)}`,
  process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
);

export async function PUT(request: Request, context:{params:Promise<{guildId:string;itemId:string}>}) {
  if(!await currentSession()) return NextResponse.json({error:"unauthorized"},{status:401});
  try{assertSameOrigin(request);}catch{return NextResponse.json({error:"bad_origin"},{status:403});}
  const {guildId,itemId}=await context.params;
  const response=await fetch(upstream(guildId,itemId),{
    method:"PUT",
    headers:{Authorization:`Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`,"content-type":"application/json"},
    body:JSON.stringify(await request.json())
  });
  return new NextResponse(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

export async function DELETE(request:Request,context:{params:Promise<{guildId:string;itemId:string}>}) {
  if(!await currentSession()) return NextResponse.json({error:"unauthorized"},{status:401});
  try{assertSameOrigin(request);}catch{return NextResponse.json({error:"bad_origin"},{status:403});}
  const {guildId,itemId}=await context.params;
  const response=await fetch(upstream(guildId,itemId),{
    method:"DELETE",
    headers:{Authorization:`Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`}
  });
  return new NextResponse(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}
