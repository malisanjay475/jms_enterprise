FROM nginx:alpine

COPY graphify-view/nginx.conf /etc/nginx/conf.d/default.conf
COPY PUBLIC/graph-view.html PUBLIC/api-inventory.json PUBLIC/graphify-graph.json /usr/share/nginx/html/

EXPOSE 80
