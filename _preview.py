import os, runpy
os.environ['JNUS_LOCAL'] = '1'   # arranque local; el puerto lo asigna el preview vía PORT
runpy.run_path('app.py', run_name='__main__')
