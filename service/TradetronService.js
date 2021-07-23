const appConfig = require("../config");
const fetch = require('node-fetch');
const Deployment = require("../model/Deployment");

/* Tradetron service
Wrappers on api calls to get the deployment values
*/


const TT_URL = 'https://tradetron.tech/api/deployed-strategies';

const options = {    
    headers: {        
        'Accept': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'Cookie': 'XSRF-TOKEN=eyJpdiI6IlFWZ1p4cjQ3YWN2ME1DWlF5RjRvZWc9PSIsInZhbHVlIjoiUDMrMHBJZVY4Yk9hZ0NSWHB2YlNvSjAxKzFrZnRLZlNPcEF2QTY4andMMWx6eUNTUmdqZGZHXC9cL0dDS3R5akZrIiwibWFjIjoiYmVjYWU4OTZhMTlmMzg5YTgyMTAxYjdlZDAzZjllZWU3YzkzMjE0MTJjODA4MjVhOGRjZjM1NGJkNTRlODk1YSJ9; tradetron_session=eyJpdiI6IktiU2dvVGo4QWpCR3FLVHg0YmM0OUE9PSIsInZhbHVlIjoiQXhMMzNFZEFVUjg1QkVmdXg0QXZnaVhoc3FwQXZvSVo1cmh5M3EyVGYrQjgzVTl6SUl3ejJyeGdwVTRsWVwvN0giLCJtYWMiOiIzMTBhZGU0OWI0MGI5MjFiZDIxMWU0NTQyOTQ5YjcxNWUyMTk1MDU3MzRiMjUzN2YwYzFlNWQxZWJiY2EwMDIxIn0%3D'
    }
}
let deploymentsArray = [];
async function Deployments(tradeOptions, page=1) {
    const {tradeType, creatorId} = tradeOptions;
    let url = new URL(TT_URL);
    url.searchParams.append("execution", tradeType);
    url.searchParams.append("creator_id", creatorId);
    url.searchParams.append("page", page);        
    const res = await fetch(url.href, options);  
    if (await res.ok) {
        //Simplify the deployment json as Deployment Objects Array       
        //console.log("tron resp: ",  await res.json()); 
        let deployments = await res.json();
  
        deployments.data.forEach(element => {
            deploymentsArray.push(
                new Deployment(element.deployment_type, 
                    element.id, 
                    element.status, 
                    element.sum_of_pnl, 
                    element.currency,
                    element.template.id, 
                    element.template.name, 
                    element.template.user.name,
                    element.template.user.id));
        });
        if(page<deployments.paginate.last_page)
            return await Deployments(tradeOptions, page+1);
        else
            return deploymentsArray;    
       
    } else {
        throw new Error('TT Api Authentication Problem');
    }


}

module.exports.Deployments = Deployments;